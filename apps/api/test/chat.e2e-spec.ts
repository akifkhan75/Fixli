import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureRealtime, RedisIoAdapter } from '../src/realtime/redis-io.adapter';
import { MatchingService } from '../src/matching/matching.service';
import { SweeperService } from '../src/matching/sweeper.service';
import { seedCatalog } from '../prisma/seed-catalog';

/**
 * doc 27 F4: real-time chat. The customer acts through instance A, the professional's phone is
 * connected to instance B, Redis in between. Set E2E_REDIS_URL to run (CI does).
 */
const REDIS_URL = process.env.E2E_REDIS_URL;
const maybe = REDIS_URL ? describe : describe.skip;

maybe('Chat (doc 27 F4, e2e, two instances)', () => {
  const apps: INestApplication[] = [];
  const adapters: RedisIoAdapter[] = [];
  let A: INestApplication;
  let B: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `chat${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const sockets: Socket[] = [];
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  let jobId: string;
  let conv: string;
  let plumbing: string;

  async function boot() {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    adapters.push((await configureRealtime(app, REDIS_URL))!);
    await app.init();
    await app.listen(0);
    apps.push(app);
    return app;
  }
  function connect(app: INestApplication, who: string) {
    const port = (app.getHttpServer().address() as any).port;
    const s = io(`http://127.0.0.1:${port}/rt`, { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    const got: { type: string; data: any }[] = [];
    s.onAny((type, env) => got.push({ type, data: env?.data ?? env }));
    return { s, got, ready: new Promise<void>((res) => s.once('ready', () => res())) };
  }
  const waitFor = async (pred: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (!pred()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); }
  };
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  async function user(k: string, type: 'customer' | 'worker' | 'admin', roles: string[] = []) {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK', adminRoles: roles } });
    if (type === 'worker') {
      await prisma.worker.create({
        data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true, serviceRadius: 10, serviceLat: 24.928, serviceLng: 67.095, services: { create: [{ categoryId: plumbing }] }, workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) } } as any,
      });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }
  const send = (who: string, body: object, app = A) => request(app.getHttpServer()).post(`/api/conversations/${conv}/messages`).set(as(who)).send(body);

  beforeAll(async () => {
    process.env.REDIS_URL = REDIS_URL;
    A = await boot();
    B = await boot();
    prisma = A.get(PrismaService);
    jwt = A.get(JwtService);
    await seedCatalog(prisma as any);
    plumbing = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    await user('cust', 'customer');
    await user('pro', 'worker');
    await user('stranger', 'customer');
    await user('safety', 'admin', ['Safety']);
    jobId = (await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', description: 'Leaking tap', title: 'Leaking tap', status: 'ACCEPTED', assignedWorkerId: ids.pro } })).id;
    conv = (await prisma.conversation.create({ data: { jobRequestId: jobId, participants: { connect: [{ id: ids.cust }, { id: ids.pro }] } } })).id;
  }, 60_000);

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.incident.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.block.deleteMany({ where: { blockerId: { in: userIds } } });
    await prisma.dispute.deleteMany({ where: { raisedById: { in: userIds } } });
    await prisma.conversation.deleteMany({ where: { jobRequest: { customerId: { in: userIds } } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const a of apps) await a.close();
    for (const ad of adapters) await ad.close();
    delete process.env.REDIS_URL;
  });

  it('the "Message" button finds the job\'s chat; strangers can\'t', async () => {
    expect((await request(A.getHttpServer()).get(`/api/conversations/by-job/${jobId}`).set(as('pro')).expect(200)).body.id).toBe(conv);
    await request(A.getHttpServer()).get(`/api/conversations/by-job/${jobId}`).set(as('stranger')).expect(404);
  });

  it('a message sent on instance A reaches the professional on instance B live, once, and the sender\'s other device', async () => {
    const pro = connect(B, 'pro');
    const custOtherPhone = connect(B, 'cust');
    await Promise.all([pro.ready, custOtherPhone.ready]);
    const r = await send('cust', { text: 'Hi, the tap is in the kitchen', clientId: 'cl-001' }).expect(201);
    await waitFor(() => pro.got.some((e) => e.type === 'message.created') && custOtherPhone.got.some((e) => e.type === 'message.created'));
    const live = pro.got.find((e) => e.type === 'message.created')!.data;
    expect(live).toMatchObject({ id: r.body.id, clientId: 'cl-001', text: 'Hi, the tap is in the kitchen', conversationId: conv });
    expect(pro.got.some((e) => e.type === 'conversation.updated')).toBe(true);

    // The outbox retrying the same message: same message, nothing new delivered.
    const again = await send('cust', { text: 'Hi, the tap is in the kitchen', clientId: 'cl-001' }).expect(201);
    expect(again.body.id).toBe(r.body.id);
    await settle();
    expect(pro.got.filter((e) => e.type === 'message.created')).toHaveLength(1);
    expect(await prisma.message.count({ where: { conversationId: conv, clientId: 'cl-001' } })).toBe(1);
  });

  it('reading shows read ticks to the sender; typing is shown, throttled', async () => {
    const cust = connect(A, 'cust');
    const pro = connect(B, 'pro');
    await Promise.all([cust.ready, pro.ready]);
    await request(B.getHttpServer()).post(`/api/conversations/${conv}/read`).set(as('pro')).expect(201);
    await waitFor(() => cust.got.some((e) => e.type === 'message.read'));
    expect(cust.got.find((e) => e.type === 'message.read')!.data).toMatchObject({ conversationId: conv, userId: ids.pro });

    await request(B.getHttpServer()).post(`/api/conversations/${conv}/typing`).set(as('pro')).expect(204);
    await request(B.getHttpServer()).post(`/api/conversations/${conv}/typing`).set(as('pro')).expect(204);
    await settle();
    expect(cust.got.filter((e) => e.type === 'chat.typing')).toHaveLength(1);
  });

  it('sharing a number: sent as written, flagged, and only the sender is reminded', async () => {
    const pro = connect(B, 'pro');
    await pro.ready;
    const r = await send('cust', { text: 'Just call me on 0300 1234567' }).expect(201);
    expect(r.body).toMatchObject({ warning: 'CONTACT_INFO', contactKinds: ['phone'] });
    await waitFor(() => pro.got.some((e) => e.type === 'message.created'));
    expect(pro.got.find((e) => e.type === 'message.created')!.data.warning).toBeUndefined();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: r.body.id } })).isFlagged).toBe(true);
    const plain = await send('cust', { text: 'It will be about Rs 1,500.00, ok?' }).expect(201);
    expect(plain.body.warning).toBeUndefined();
  });

  it('the list shows the job, the other person and unread counts', async () => {
    const list = await request(A.getHttpServer()).get('/api/conversations').set(as('pro')).expect(200);
    const item = list.body.items.find((c: any) => c.id === conv);
    expect(item).toMatchObject({ job: { id: jobId, title: 'Leaking tap' }, counterpart: { id: ids.cust }, isReadOnly: false, blockedByMe: false });
    expect(item.unreadCount).toBeGreaterThanOrEqual(2);
    expect(item.lastMessage.imageKey).toBeUndefined();
  });

  it('blocking works everywhere: no messages either way, no matching, no prices; unblock restores', async () => {
    await request(A.getHttpServer()).post(`/api/conversations/${conv}/block`).set(as('cust')).send({ reason: 'Rude' }).expect(201);
    expect((await send('cust', { text: 'hello?' }).expect(403)).body.error.code).toBe('BLOCKED');
    expect((await send('pro', { text: 'sorry' }, B).expect(403)).body.error.code).toBe('BLOCKED');

    // A new request from the same customer never reaches the blocked professional.
    const fresh = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', description: 'Drain', status: 'MATCHES_FOUND', categoryId: plumbing, latitude: 24.92, longitude: 67.09 } });
    await A.get(MatchingService).matchJob(fresh.id, 1);
    expect(await prisma.jobMatch.count({ where: { jobRequestId: fresh.id, workerId: ids.pro } })).toBe(0);
    // Even if already matched before the block, no price can be sent.
    await prisma.jobMatch.create({ data: { jobRequestId: fresh.id, workerId: ids.pro, round: 1, rank: 1, score: 1 } });
    await request(B.getHttpServer()).post(`/api/job-requests/${fresh.id}/offers`).set(as('pro')).send({ amount: 100_000 }).expect(404);

    const blocked = await request(A.getHttpServer()).get('/api/users/me/blocks').set(as('cust')).expect(200);
    expect(blocked.body.map((b: any) => b.blockedId)).toEqual([ids.pro]);
    await request(A.getHttpServer()).delete(`/api/users/me/blocks/${ids.pro}`).set(as('cust')).expect(200);
    await send('cust', { text: 'ok, let us continue' }).expect(201);
  });

  it('a report reaches the safety team as an incident, live', async () => {
    const safety = connect(B, 'safety');
    await safety.ready;
    const r = await request(A.getHttpServer()).post(`/api/conversations/${conv}/report`).set(as('pro')).send({ reason: 'SCAM', details: 'Asked me to pay a deposit' }).expect(201);
    await waitFor(() => safety.got.some((e) => e.type === 'staff.incident_reported'));
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: r.body.incidentId } })).toMatchObject({ type: 'REPORT_USER', targetId: ids.cust, jobRequestId: jobId });
    await request(A.getHttpServer()).post(`/api/conversations/${conv}/report`).set(as('pro')).send({ reason: 'NOT_A_REASON' }).expect(400);
  });

  it('a chat closes some days after the job ends; a dispute reopens it', async () => {
    await prisma.jobRequest.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
    await prisma.$executeRaw`UPDATE "JobRequest" SET "updatedAt" = now() - interval '5 days' WHERE id = ${jobId}`;
    await A.get(SweeperService).sweep();
    const closed = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect(closed.isReadOnly).toBe(true);
    expect(closed.closedAt).toBeTruthy();
    expect((await send('cust', { text: 'one more thing' }).expect(400)).body.error.code).toBe('CONVERSATION_READ_ONLY');

    await request(A.getHttpServer()).post('/api/disputes').set(as('cust')).send({ jobRequestId: jobId, reason: 'Leak is back', category: 'QUALITY' }).expect(201);
    await send('cust', { text: 'the leak is back' }).expect(201);
    await A.get(SweeperService).sweep(); // stays open while the dispute is open
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv } })).isReadOnly).toBe(false);
  });

  it('the stranger heard nothing', async () => {
    expect(await prisma.notification.count({ where: { userId: ids.stranger } })).toBe(0);
  });
});
