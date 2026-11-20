import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { NotificationService } from '../src/notifications/notifications.service';
import { SosSweeper } from '../src/safety/sos.sweeper';
import { seedCatalog } from '../prisma/seed-catalog';

const HOME = { lat: 24.92, lng: 67.09 };
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

/** doc 27 F5: SOS and safety, end to end. */
describe('SOS and safety (doc 27 F5, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `sos${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let plumbing: string;
  let n = 0;

  async function user(k: string, type: 'customer' | 'worker', at?: { lat: number; lng: number }) {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone: `+92303${String(Date.now()).slice(-6)}${n++}`.slice(0, 13), password: await bcrypt.hash('x', 4), type, countryCode: 'PK' } });
    if (type === 'worker') {
      await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true, isVerified: true, serviceRadius: 10, serviceLat: at!.lat, serviceLng: at!.lng, services: { create: [{ categoryId: plumbing }] }, workingHours: { create: ALL_WEEK } } as any });
    } else {
      await prisma.address.create({ data: { userId: u.id, streetAddress: 'House 7', city: 'Karachi', area: 'Gulshan', country: 'PK', latitude: HOME.lat, longitude: HOME.lng, isDefault: true } });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }
  const sos = (who: string, body: object) => http().post('/api/safety/sos').set(as(who)).send({ idempotencyKey: `${tag}-${++n}`, ...body });
  const types = async (k: string) => { await app.get(NotificationService).idle(); return (await prisma.notification.findMany({ where: { userId: ids[k] } })).map((x) => x.type); };
  const dispatch = (jobId: string) => prisma.sosDispatch.findUniqueOrThrow({ where: { jobRequestId: jobId } });
  const job = (jobId: string) => prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await seedCatalog(prisma as any);
    plumbing = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    await user('cust', 'customer');
    await user('cust2', 'customer');
    await user('busy', 'worker', { lat: 24.921, lng: 67.091 });   // closest, but on a job right now
    await user('near', 'worker', { lat: 24.928, lng: 67.095 });   // ~1 km
    await user('mid', 'worker', { lat: 24.947, lng: 67.09 });     // ~3 km
    await user('far', 'worker', { lat: 24.965, lng: 67.09 });     // ~5 km
    await user('extra', 'worker', { lat: 24.98, lng: 67.09 });    // ~6.7 km: only reached by normal offers
    await prisma.jobRequest.create({ data: { customerId: ids.cust2, customerName: 'x', description: 'Busy job', status: 'IN_PROGRESS', assignedWorkerId: ids.busy } });
  }, 60_000);

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.incident.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.trustedContact.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('emergency numbers come from the country configuration', async () => {
    const r = await http().get('/api/safety/emergency-numbers').set(as('cust')).expect(200);
    expect(r.body).toMatchObject({ countryCode: 'PK' });
    expect(r.body.numbers.map((x: any) => x.number)).toEqual(expect.arrayContaining(['15', '1122']));
  });

  it('life-threatening: numbers, the safety team, contacts (honestly NOT texted: no provider), and no worker ever', async () => {
    await http().post('/api/safety/trusted-contacts').set(as('cust')).send({ name: 'Sister', phone: '0300 1234567' }).expect(201);
    const before = await prisma.jobRequest.count({ where: { customerId: ids.cust } });
    const r = await sos('cust', { kind: 'LIFE_THREATENING' }).expect(200);
    expect(r.body).toMatchObject({ kind: 'LIFE_THREATENING', jobRequestId: null, contacts: { status: 'NO_PROVIDER', alerted: 0 } });
    expect(r.body.emergencyNumbers.length).toBeGreaterThan(0);
    expect(await prisma.jobRequest.count({ where: { customerId: ids.cust } })).toBe(before);
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: r.body.incidentId } })).toMatchObject({ type: 'SOS', severity: 'LIFE_THREATENING' });
  });

  it('a double tap is one emergency', async () => {
    const body = { kind: 'WATER', idempotencyKey: `${tag}-dbl` };
    const [a, b] = await Promise.all([http().post('/api/safety/sos').set(as('cust2')).send(body), http().post('/api/safety/sos').set(as('cust2')).send(body)]);
    expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    const ok = [a, b].filter((r) => r.status === 200);
    expect(new Set(ok.map((r) => r.body.incidentId)).size).toBe(1);
    expect(await prisma.sosDispatch.count({ where: { jobRequest: { customerId: ids.cust2 } } })).toBe(1);
    await http().post(`/api/job-requests/${ok[0].body.jobRequestId}/cancel`).set(as('cust2')).send({ reason: 'OTHER' }).expect(201);
  });

  describe('water emergency: nearest free worker first, one at a time', () => {
    let jobId: string;

    it('goes to the nearest FREE worker (skips the one on a job), only them', async () => {
      const r = await sos('cust', { kind: 'WATER', note: 'Pipe burst under the sink' }).expect(200);
      jobId = r.body.jobRequestId;
      expect(await job(jobId)).toMatchObject({ status: 'AWAITING_WORKER', assignedWorkerId: ids.near, isEmergency: true });
      expect(await dispatch(jobId)).toMatchObject({ status: 'OFFERING', attempt: 1, currentWorkerId: ids.near });
      expect(await types('near')).toContain('job.sos_request');
      for (const w of ['busy', 'mid', 'far', 'extra']) expect(await types(w)).not.toContain('job.sos_request');
      await http().get(`/api/job-requests/${jobId}`).set(as('mid')).expect(404);
      await http().get(`/api/job-requests/${jobId}`).set(as('near')).expect(200);
    });

    it('a decline moves to the next nearest at once', async () => {
      await http().post(`/api/job-requests/${jobId}/decline`).set(as('near')).expect(201);
      await new Promise((r) => setTimeout(r, 200));
      expect(await dispatch(jobId)).toMatchObject({ attempt: 2, currentWorkerId: ids.mid });
      expect(await job(jobId)).toMatchObject({ status: 'AWAITING_WORKER', assignedWorkerId: ids.mid });
    });

    it('no answer in time: the next one is asked', async () => {
      await prisma.sosDispatch.update({ where: { jobRequestId: jobId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await app.get(SosSweeper).sweep();
      expect(await dispatch(jobId)).toMatchObject({ attempt: 3, currentWorkerId: ids.far });
      // The timed-out worker can no longer accept.
      await http().post(`/api/job-requests/${jobId}/accept`).set(as('mid')).expect(404);
    });

    it('after 3 tries it falls back to normal offers from others nearby, and the customer is told', async () => {
      await prisma.sosDispatch.update({ where: { jobRequestId: jobId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await app.get(SosSweeper).sweep();
      expect(await dispatch(jobId)).toMatchObject({ status: 'FALLBACK', currentWorkerId: null });
      expect(await job(jobId)).toMatchObject({ status: 'MATCHES_FOUND', assignedWorkerId: null });
      expect(await prisma.jobMatch.count({ where: { jobRequestId: jobId, workerId: ids.extra } })).toBe(1);
      expect(await types('extra')).toContain('job.request');
      expect(await types('cust')).toContain('sos.searching_wider');
      const events = (await prisma.jobEvent.findMany({ where: { jobRequestId: jobId }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);
      expect(events).toEqual(expect.arrayContaining(['SOS_OFFERED', 'WORKER_DECLINED', 'SOS_TIMED_OUT', 'SOS_FALLBACK', 'PROFESSIONALS_NOTIFIED']));
    });
  });

  it('when the nearest worker accepts, the job is booked and the dispatch stops', async () => {
    const r = await sos('cust2', { kind: 'ELECTRIC' }).expect(200);
    // No electricians in this test: nobody to ask, so it goes straight to normal offers.
    expect(await dispatch(r.body.jobRequestId)).toMatchObject({ status: 'FALLBACK' });

    const w = await sos('cust2', { kind: 'GAS' }).expect(200);
    const d = await dispatch(w.body.jobRequestId);
    await http().post(`/api/job-requests/${w.body.jobRequestId}/accept`).set(as(Object.keys(ids).find((k) => ids[k] === d.currentWorkerId)!)).expect(201);
    await new Promise((r) => setTimeout(r, 200)); // the answer is handled just after the response
    expect(await dispatch(w.body.jobRequestId)).toMatchObject({ status: 'ACCEPTED' });
    // Even if the timeout check ran first, a booked job ends the dispatch.
    await prisma.sosDispatch.update({ where: { jobRequestId: w.body.jobRequestId }, data: { status: 'OFFERING', expiresAt: new Date(Date.now() - 1000) } });
    await app.get(SosSweeper).sweep();
    expect(await dispatch(w.body.jobRequestId)).toMatchObject({ status: 'ACCEPTED' });
    expect((await job(w.body.jobRequestId)).status).toBe('ACCEPTED');
  });

  it('a customer cancelling during the offer stops the dispatch', async () => {
    const r = await sos('cust', { kind: 'WATER' }).expect(200);
    await http().post(`/api/job-requests/${r.body.jobRequestId}/cancel`).set(as('cust')).send({ reason: 'OTHER' }).expect(201);
    await prisma.sosDispatch.update({ where: { jobRequestId: r.body.jobRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await app.get(SosSweeper).sweep();
    expect(await dispatch(r.body.jobRequestId)).toMatchObject({ status: 'CANCELLED' });
  });

  it('workers use in-job SOS (not property dispatch); it records the other person', async () => {
    await sos('near', { kind: 'WATER' }).expect(403);
    const j = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', description: 'x', status: 'IN_PROGRESS', assignedWorkerId: ids.mid } });
    const r = await sos('mid', { kind: 'IN_JOB', jobRequestId: j.id }).expect(200);
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: r.body.incidentId } })).toMatchObject({ kind: 'IN_JOB', targetId: ids.cust, jobRequestId: j.id });
    await sos('far', { kind: 'IN_JOB', jobRequestId: j.id }).expect(404);
  });

  it('trusted contacts: normalised, max 5, never your own number', async () => {
    await http().post('/api/safety/trusted-contacts').set(as('cust2')).send({ name: 'Me', phone: (await prisma.user.findUniqueOrThrow({ where: { id: ids.cust2 } })).phone }).expect(400);
    for (let i = 0; i < 5; i++) await http().post('/api/safety/trusted-contacts').set(as('cust2')).send({ name: `C${i}`, phone: `0301 000000${i}` }).expect(201);
    await http().post('/api/safety/trusted-contacts').set(as('cust2')).send({ name: 'Sixth', phone: '0301 0000009' }).expect(400);
    const list = await http().get('/api/safety/trusted-contacts').set(as('cust2')).expect(200);
    expect(list.body[0].phone).toMatch(/^\+92301/);
  });
});
