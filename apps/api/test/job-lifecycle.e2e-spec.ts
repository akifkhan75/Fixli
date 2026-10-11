import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { JobLifecycleSweeper } from '../src/jobs/job-lifecycle.sweeper';
import { NotificationService } from '../src/notifications/notifications.service';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixli-e2e-life-'));
process.env.STORAGE_LOCAL_DIR = storageDir;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(600, 7)]);
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');
const HOME = { lat: 24.92, lng: 67.09 };

/** doc 27 F2: the on-site part of a job, end to end, with two parties and a stranger. */
describe('Job lifecycle on site (doc 27 F2, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `life${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const sockets: Socket[] = [];
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let jobId: string;
  let n = 0;

  async function user(k: string, type: 'customer' | 'worker') {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone: `+9230${String(Date.now()).slice(-7)}${n++}`.slice(0, 13), password: await bcrypt.hash('x', 4), type, countryCode: 'PK' } });
    if (type === 'worker') await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }
  async function upload(who: string) {
    const bytes = jpeg();
    const slot = await http().post('/api/uploads').set(as(who)).send({ purpose: 'JOB_PHOTO', mime: 'image/jpeg', size: bytes.length }).expect(201);
    await http().put(pathOf(slot.body.upload.url)).set('Content-Type', 'image/jpeg').send(bytes).expect(200);
    await http().post(`/api/uploads/${slot.body.id}/complete`).set(as(who)).expect(201);
    return slot.body.id as string;
  }
  async function bookedJob(customer: string, worker: string, over: object = {}) {
    const job = await prisma.jobRequest.create({
      data: {
        customerId: ids[customer], customerName: customer, description: 'Leaking tap', title: 'Leaking tap', status: 'ACCEPTED', assignedWorkerId: ids[worker],
        agreedAmount: 150000, agreedCurrency: 'PKR', latitude: HOME.lat, longitude: HOME.lng, bookedAt: new Date(),
        scheduledFrom: new Date(), scheduledTo: new Date(Date.now() + 2 * 3600_000), ...over,
      },
    });
    await prisma.conversation.create({ data: { jobRequestId: job.id, participants: { connect: [{ id: ids[customer] }, { id: ids[worker] }] } } });
    return job.id;
  }
  function connect(who: string) {
    const port = (app.getHttpServer().address() as any).port;
    const s = io(`http://127.0.0.1:${port}/rt`, { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    const got: { type: string; data: any }[] = [];
    s.onAny((type, data) => got.push({ type, data }));
    return { s, got, ready: new Promise<void>((res) => s.once('ready', () => res())) };
  }
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const types = async (who: string) => { await app.get(NotificationService).idle(); return (await prisma.notification.findMany({ where: { userId: ids[who] }, orderBy: { createdAt: 'asc' } })).map((x) => x.type); };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    for (const [k, t] of [['cust', 'customer'], ['cust2', 'customer'], ['stranger', 'customer'], ['pro', 'worker'], ['pro2', 'worker']] as const) await user(k, t);
    jobId = await bookedJob('cust', 'pro');
  }, 60_000);

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.dispute.deleteMany({ where: { raisedById: { in: userIds } } });
    await prisma.conversation.deleteMany({ where: { jobRequest: { customerId: { in: userIds } } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fs.rmSync(storageDir, { recursive: true, force: true });
    await app.close();
  });

  it('while booked, each side can reveal the other\'s number (audited); nobody else can', async () => {
    const r = await http().get(`/api/job-requests/${jobId}/contact`).set(as('cust')).expect(200);
    expect(r.body).toMatchObject({ name: 'pro Person', phone: expect.stringMatching(/^\+92/) });
    await http().get(`/api/job-requests/${jobId}/contact`).set(as('pro')).expect(200);
    await http().get(`/api/job-requests/${jobId}/contact`).set(as('stranger')).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'job.contact_revealed', entityId: jobId } })).toBe(2);
  });

  it('on the way: the customer (only) gets live position with an ETA, throttled and stored sparsely', async () => {
    const cust = connect('cust');
    const stranger = connect('stranger');
    const pro = connect('pro');
    await Promise.all([cust.ready, stranger.ready, pro.ready]);

    // Not yet on the way: location is dropped.
    pro.s.emit('locationUpdate', { jobId, latitude: 24.95, longitude: 67.09 });
    await settle();
    expect(cust.got.filter((e) => e.type === 'locationUpdate')).toHaveLength(0);

    await http().post(`/api/job-requests/${jobId}/en-route`).set(as('pro')).expect(201);
    pro.s.emit('locationUpdate', { jobId, latitude: 24.95, longitude: 67.09 });
    await settle();
    pro.s.emit('locationUpdate', { jobId, latitude: 24.949, longitude: 67.09 }); // within 5 s: dropped
    await settle();
    const updates = cust.got.filter((e) => e.type === 'locationUpdate');
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toMatchObject({ jobId, latitude: 24.95, etaMinutes: expect.any(Number) });
    expect(updates[0].data.etaMinutes).toBeGreaterThan(5); // ~3.3 km at 20 km/h × 1.3
    expect(stranger.got.filter((e) => e.type === 'locationUpdate')).toHaveLength(0);
    expect(await prisma.jobLocationPoint.count({ where: { jobRequestId: jobId } })).toBe(1);

    const last = await http().get(`/api/job-requests/${jobId}/location`).set(as('cust')).expect(200);
    expect(last.body.location).toMatchObject({ latitude: 24.95, etaMinutes: expect.any(Number) });
    await http().get(`/api/job-requests/${jobId}/location`).set(as('pro')).expect(404);
    expect(await types('cust')).toContain('job.en_route');
    // Lists know the new steps (Today / Jobs read the "active" group).
    const active = await http().get('/api/job-requests?group=active').set(as('pro')).expect(200);
    expect(active.body.items.map((j: any) => j.id)).toContain(jobId);
    await http().get('/api/job-requests?status=EN_ROUTE').set(as('pro')).expect(200);
  });

  it('a worker on the way cannot be booked for something starting soon; a booking next week is fine', async () => {
    const make = async (from: Date) => {
      const j = await prisma.jobRequest.create({ data: { customerId: ids.cust2, customerName: 'c2', description: 'Fan', status: 'MATCHES_FOUND', scheduledFrom: from, scheduledTo: new Date(from.getTime() + 2 * 3600_000), matchRound: 1 } });
      await prisma.jobMatch.create({ data: { jobRequestId: j.id, workerId: ids.pro, round: 1, rank: 1, score: 1 } });
      return prisma.offer.create({ data: { jobRequestId: j.id, workerId: ids.pro, amount: 100000, currency: 'PKR', status: 'PENDING', expiresAt: new Date(Date.now() + 600_000) } });
    };
    const soon = await make(new Date(Date.now() + 30 * 60_000));
    const r = await http().post(`/api/offers/${soon.id}/accept`).set(as('cust2')).expect(409);
    expect(r.body.error.code).toBe('WORKER_BUSY');
    const nextWeek = await make(new Date(Date.now() + 7 * 86_400_000));
    await http().post(`/api/offers/${nextWeek.id}/accept`).set(as('cust2')).expect((x) => expect([200, 201]).toContain(x.status));
  });

  it('arrive, then start: a before photo (the worker\'s own) or a reason is required', async () => {
    await http().post(`/api/job-requests/${jobId}/arrive`).set(as('pro')).expect(201);
    expect(await types('cust')).toContain('job.arrived');
    await http().post(`/api/job-requests/${jobId}/start`).set(as('pro')).send({}).expect(400);
    const photo = await upload('pro');
    await http().post(`/api/job-requests/${jobId}/start`).set(as('pro')).send({ photoUploadIds: [photo] }).expect(201);
    const view = await http().get(`/api/job-requests/${jobId}`).set(as('cust')).expect(200);
    expect(view.body.status).toBe('IN_PROGRESS');
    expect(view.body.media.length).toBeGreaterThanOrEqual(1);
  });

  it('a change order changes the agreed price only when the customer approves', async () => {
    const co = await http().post('/api/change-orders').set(as('pro')).send({ jobRequestId: jobId, reason: 'Pipe cracked', addedScope: 'Replace 1 m of pipe', revisedPrice: 250000 }).expect(201);
    expect(co.body).toMatchObject({ currency: 'PKR', status: 'PENDING' });
    await http().post('/api/change-orders').set(as('pro')).send({ jobRequestId: jobId, reason: 'Also', addedScope: 'More', revisedPrice: 300000 }).expect(409);
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).agreedAmount).toBe(150000);
    expect(await types('cust')).toContain('change_order.created');

    await http().patch(`/api/change-orders/${co.body.id}/status`).set(as('pro')).send({ status: 'APPROVED' }).expect(403);
    await http().patch(`/api/change-orders/${co.body.id}/status`).set(as('cust')).send({ status: 'APPROVED' }).expect(200);
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).agreedAmount).toBe(250000);
    await http().patch(`/api/change-orders/${co.body.id}/status`).set(as('cust')).send({ status: 'REJECTED' }).expect(409);
    expect(await types('pro')).toContain('change_order.approved');
  });

  it('finish needs an after photo; then only the customer can confirm (no /complete for workers)', async () => {
    await http().post(`/api/job-requests/${jobId}/finish`).set(as('pro')).send({}).expect(400);
    await http().post(`/api/job-requests/${jobId}/finish`).set(as('pro')).send({ photoUploadIds: [await upload('pro')] }).expect(201);
    const j = await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } });
    expect(j.status).toBe('AWAITING_CONFIRMATION');
    expect(j.finishedAt).toBeTruthy();
    expect(await types('cust')).toContain('job.awaiting_confirmation');

    await http().post(`/api/job-requests/${jobId}/confirm`).set(as('pro')).expect(403);
    await http().post(`/api/job-requests/${jobId}/complete`).set(as('pro')).expect(404);
    await http().post(`/api/job-requests/${jobId}/confirm`).set(as('cust')).expect(201);
    const done = await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } });
    expect(done).toMatchObject({ status: 'COMPLETED', autoConfirmed: false });
    expect(await types('pro')).toContain('job.confirmed');
  });

  it('the chat shows each step as a system line, in order; the number is hidden again', async () => {
    const msgs = await prisma.message.findMany({ where: { conversation: { jobRequestId: jobId }, isSystem: true }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.systemKey)).toEqual(['job.en_route', 'job.arrived', 'job.started', 'job.finished', 'job.confirmed']);
    await http().get(`/api/job-requests/${jobId}/contact`).set(as('cust')).expect(409);
  });

  it('auto-confirm: an unconfirmed finished job completes after the wait, unless a dispute is open', async () => {
    const old = new Date(Date.now() - 25 * 3600_000);
    const quiet = await bookedJob('cust2', 'pro2', { status: 'AWAITING_CONFIRMATION', finishedAt: old });
    const disputed = await bookedJob('cust2', 'pro2', { status: 'AWAITING_CONFIRMATION', finishedAt: old });
    const fresh = await bookedJob('cust2', 'pro2', { status: 'AWAITING_CONFIRMATION', finishedAt: new Date() });
    await prisma.dispute.create({ data: { jobRequestId: disputed, raisedById: ids.cust2, reason: 'Leak still there' } });
    await prisma.jobLocationPoint.create({ data: { jobRequestId: quiet, latitude: 1, longitude: 1, at: new Date(Date.now() - 40 * 86_400_000) } });

    const r = await app.get(JobLifecycleSweeper).sweep();
    expect(r).toMatchObject({ autoConfirmed: 1, locationPointsDeleted: 1 });
    expect(await prisma.jobRequest.findUniqueOrThrow({ where: { id: quiet } })).toMatchObject({ status: 'COMPLETED', autoConfirmed: true });
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: disputed } })).status).toBe('AWAITING_CONFIRMATION');
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: fresh } })).status).toBe('AWAITING_CONFIRMATION');
    expect(await types('pro2')).toContain('job.auto_confirmed');
    expect(await types('cust2')).toContain('job.auto_confirmed');
    // Running again does nothing more.
    expect(await app.get(JobLifecycleSweeper).sweep()).toMatchObject({ autoConfirmed: 0 });
  });

  it('a customer can still cancel while the worker is on the way (recorded as late), not once work started', async () => {
    const j = await bookedJob('cust2', 'pro2', { status: 'EN_ROUTE' });
    const r = await http().post(`/api/job-requests/${j}/cancel`).set(as('cust2')).send({ reason: 'TOO_SLOW' }).expect(201);
    expect(r.body.events.at(-1).payload).toMatchObject({ late: true });
    const started = await bookedJob('cust2', 'pro2', { status: 'IN_PROGRESS' });
    expect((await http().post(`/api/job-requests/${started}/cancel`).set(as('cust2')).send({ reason: 'TOO_SLOW' }).expect(409)).body.error.code).toBe('CANNOT_CANCEL_NOW');
  });

  it('the stranger was never told anything', async () => {
    expect(await types('stranger')).toEqual([]);
  });
});
