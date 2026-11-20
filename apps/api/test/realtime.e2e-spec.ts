import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { NotificationService } from '../src/notifications/notifications.service';
import { PUSH_PROVIDER, PushMessage } from '../src/notifications/push.provider';
import { configureRealtime, RedisIoAdapter } from '../src/realtime/redis-io.adapter';
import { seedCatalog } from '../prisma/seed-catalog';

/**
 * Two API instances share Redis, like production behind a load balancer. The customer's phone is
 * connected to instance B; the worker acts through instance A. Set E2E_REDIS_URL to run it
 * (skipped without). Scoped to this suite so other suites keep in-memory rate limits.
 */
const REDIS_URL = process.env.E2E_REDIS_URL;
const HOME = { lat: 24.92, lng: 67.09 };
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
const maybe = REDIS_URL ? describe : describe.skip;

maybe('Realtime + notifications across instances (e2e)', () => {
  const apps: INestApplication[] = [];
  const adapters: RedisIoAdapter[] = [];
  const pushed: PushMessage[] = [];
  const fakePush = { name: 'fake', send: async (m: PushMessage[]) => { pushed.push(...m); return m.map(() => ({ ok: true as const })); } };
  let A: INestApplication;
  let B: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `rt${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const sids: Record<string, string> = {};
  const sockets: Socket[] = [];
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  let plumbingId: string;

  async function boot() {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PUSH_PROVIDER).useValue(fakePush).compile();
    const app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    adapters.push((await configureRealtime(app, REDIS_URL))!);
    await app.init();
    await app.listen(0);
    apps.push(app);
    return app;
  }
  const url = (app: INestApplication) => `http://127.0.0.1:${(app.getHttpServer().address() as any).port}/rt`;

  /** Connects and records every event, resolving once the server says "ready". */
  function connect(app: INestApplication, who: string) {
    const s = io(url(app), { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    const got: { type: string; data: any }[] = [];
    s.onAny((type, env) => got.push({ type, data: env?.data ?? env }));
    const ready = new Promise<void>((res, rej) => { s.once('ready', () => res()); s.once('connect_error', rej); s.once('error', rej); });
    return { s, got, ready };
  }
  const waitFor = async (pred: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (!pred()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 25)); }
  };

  async function user(k: string, type: 'customer' | 'worker', worker?: Record<string, unknown>) {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK', locale: k === 'cust' ? 'ur' : 'en' } });
    if (type === 'worker') {
      await prisma.worker.create({
        data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true, isVerified: true, serviceRadius: 10, ...worker, services: { create: [{ categoryId: plumbingId }] }, workingHours: { create: ALL_WEEK } } as any,
      });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id; sids[k] = s.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  beforeAll(async () => {
    process.env.REDIS_URL = REDIS_URL;
    A = await boot();
    B = await boot();
    prisma = A.get(PrismaService);
    jwt = A.get(JwtService);
    await seedCatalog(prisma as any);
    plumbingId = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    await user('cust', 'customer');
    await user('pro', 'worker', { serviceLat: 24.928, serviceLng: 67.095, rating: 4.8 });
    await user('pro2', 'worker', { serviceLat: 24.93, serviceLng: 67.093, rating: 4.1 });
    // Same trade, far away (Lahore): never matched, must hear nothing about this job.
    await user('stranger', 'worker', { serviceLat: 31.52, serviceLng: 74.35 });
    await prisma.address.create({ data: { userId: ids.cust, streetAddress: 'House 12', city: 'Karachi', area: 'Gulshan', country: 'PK', latitude: HOME.lat, longitude: HOME.lng, isDefault: true } });
  }, 60_000);

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    const userIds = Object.values(ids);
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const a of apps) await a.close();
    for (const ad of adapters) await ad.close();
    delete process.env.REDIS_URL;
  });

  let jobId: string;
  let offerId: string;
  let stranger: ReturnType<typeof connect>;

  it('refuses a socket without a valid, live session', async () => {
    stranger = connect(A, 'stranger');
    await stranger.ready;
    const s = io(url(B), { auth: { token: 'nope' }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    await new Promise<void>((res) => s.once('disconnect', () => res()));
  });

  it('registers this device for push (session-bound, format-checked)', async () => {
    await request(A.getHttpServer()).put('/api/notifications/push-token').set(as('cust')).send({ token: 'not-a-token' }).expect(400);
    await request(A.getHttpServer()).put('/api/notifications/push-token').set(as('cust')).send({ token: 'ExponentPushToken[cust-phone]' }).expect(200);
    await request(A.getHttpServer()).put('/api/notifications/push-token').set(as('pro')).send({ token: 'ExponentPushToken[pro-phone]' }).expect(200);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sids.cust } })).pushToken).toBe('ExponentPushToken[cust-phone]');
  });

  it('a new request reaches the matched worker live (connected to the other instance) and by push', async () => {
    const pro = connect(B, 'pro');
    await pro.ready;
    const res = await request(A.getHttpServer()).post('/api/job-requests').set(as('cust'))
      .send({ categoryId: plumbingId, issueCodes: ['leaking_tap'], addressId: (await prisma.address.findFirstOrThrow({ where: { userId: ids.cust } })).id, when: 'TODAY', idempotencyKey: `${tag}-job-1-zzzzzz` })
      .expect(201);
    jobId = res.body.id;
    await waitFor(() => pro.got.some((e) => e.type === 'notification.created') && pro.got.some((e) => e.type === 'feed.updated'));
    const n = pro.got.find((e) => e.type === 'notification.created')!.data;
    expect(n).toMatchObject({ type: 'job.request', title: 'New request near you', data: { url: `/(worker)/job/${jobId}`, jobId } });
    expect(JSON.stringify(n)).not.toMatch(/House 12/); // no exact address before booking
    await A.get(NotificationService).idle();
    expect(pushed.find((p) => p.to === 'ExponentPushToken[pro-phone]')).toMatchObject({ title: 'New request near you', channelId: 'requests' });
  });

  it("a worker's price updates the customer's screen on the other instance, in the customer's language", async () => {
    const cust = connect(B, 'cust');
    await cust.ready;
    const res = await request(A.getHttpServer()).post(`/api/job-requests/${jobId}/offers`).set(as('pro')).send({ amount: 150000, etaMinutes: 30 }).expect(201);
    offerId = res.body.id;
    await waitFor(() => cust.got.some((e) => e.type === 'offers.updated') && cust.got.some((e) => e.type === 'notification.created'));
    expect(cust.got.find((e) => e.type === 'offers.updated')!.data).toEqual({ jobId });
    expect(cust.got.find((e) => e.type === 'notification.created')!.data.title).toBe('آپ کو قیمت ملی');

    // Revising the price refreshes the list but does not buzz the customer again.
    const before = await prisma.notification.count({ where: { userId: ids.cust } });
    await request(A.getHttpServer()).post(`/api/job-requests/${jobId}/offers`).set(as('pro')).send({ amount: 140000 }).expect(201);
    await waitFor(() => cust.got.filter((e) => e.type === 'offers.updated').length >= 2);
    expect(await prisma.notification.count({ where: { userId: ids.cust } })).toBe(before);
  });

  it('booking tells the chosen worker, quietly tells the other one, and updates both screens', async () => {
    await request(A.getHttpServer()).post(`/api/job-requests/${jobId}/offers`).set(as('pro2')).send({ amount: 160000 }).expect(201);
    const pro2 = connect(B, 'pro2');
    await pro2.ready;
    await request(A.getHttpServer()).post(`/api/offers/${offerId}/accept`).set(as('cust')).expect((r) => expect([200, 201]).toContain(r.status));
    await waitFor(() => pro2.got.some((e) => e.type === 'feed.updated'));
    const types = async (k: string) => (await prisma.notification.findMany({ where: { userId: ids[k] } })).map((n) => n.type);
    expect(await types('pro')).toContain('offer.accepted');
    expect(await types('pro2')).toContain('offer.not_chosen');
    await A.get(NotificationService).idle();
    expect(pushed.some((p) => p.data?.jobId === jobId && p.title === "You're booked!")).toBe(true);
  });

  it('job progress reaches the customer; the notification centre lists, counts and marks read', async () => {
    await request(A.getHttpServer()).post(`/api/job-requests/${jobId}/start`).set(as('pro')).send({ photoSkipReason: 'NOT_APPLICABLE' }).expect((r) => expect([200, 201]).toContain(r.status));
    const list = await request(B.getHttpServer()).get('/api/notifications').set(as('cust')).expect(200);
    expect(list.body.items[0]).toMatchObject({ type: 'job.started', readAt: null, data: { url: `/(customer)/job/${jobId}` } });
    expect((await request(B.getHttpServer()).get('/api/notifications/unread-count').set(as('cust')).expect(200)).body.count).toBeGreaterThanOrEqual(2);
    await request(B.getHttpServer()).post('/api/notifications/read').set(as('cust')).send({ ids: [list.body.items[0].id] }).expect(200);
    await request(B.getHttpServer()).post('/api/notifications/read').set(as('pro')).send({}).expect(200); // someone else's "read all" never touches mine
    const after = await request(B.getHttpServer()).get('/api/notifications').set(as('cust')).expect(200);
    expect(after.body.items[0].readAt).not.toBeNull();
    expect(after.body.items[1].readAt).toBeNull();
    // catch-up after being offline
    const since = await request(B.getHttpServer()).get(`/api/notifications?since=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`).set(as('cust')).expect(200);
    expect(since.body.items).toEqual([]);
  });

  it('an unrelated account received nothing at all', async () => {
    expect(stranger.got.filter((e) => e.type !== 'ready')).toEqual([]);
    expect(await prisma.notification.count({ where: { userId: ids.stranger } })).toBe(0);
    expect(pushed.filter((p) => JSON.stringify(p).includes(ids.stranger))).toEqual([]);
  });

  it('signing out on instance A drops the socket held on instance B, and stops push to that phone', async () => {
    const cust = connect(B, 'cust');
    await cust.ready;
    const dropped = new Promise<void>((res) => cust.s.once('disconnect', () => res()));
    await request(A.getHttpServer()).post('/api/auth/logout').set(as('cust')).expect((r) => expect([200, 201, 204]).toContain(r.status));
    await dropped;
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sids.cust } })).pushToken).toBeNull();
  });
});
