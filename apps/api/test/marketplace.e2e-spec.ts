import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SweeperService } from '../src/matching/sweeper.service';
import { seedCatalog } from '../prisma/seed-catalog';

// Customer address: Gulshan, Karachi.
const HOME = { lat: 24.92, lng: 67.09 };
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

describe('Matching, offers and booking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let sweeper: SweeperService;
  const tag = `mkt${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let plumbingId: string;
  let electricalId: string;
  let addressId: string;
  let n = 0;
  const key = () => `${tag}-${++n}-zzzzzzzz`;

  async function user(k: string, type: 'customer' | 'worker', worker?: Record<string, unknown>, skills: string[] = []) {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK' } });
    if (type === 'worker') {
      const { __hours, ...fields } = (worker ?? {}) as Record<string, unknown>;
      await prisma.worker.create({
        data: {
          id: u.id, activationStatus: 'ACTIVE', isOnline: true, isVerified: true, serviceRadius: 10, ...fields,
          services: { create: skills.map((categoryId) => ({ categoryId })) },
          workingHours: { create: (__hours as any) ?? ALL_WEEK },
        } as any,
      });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    sweeper = app.get(SweeperService);
    await seedCatalog(prisma as any);
    plumbingId = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    electricalId = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'ELECTRICAL' } })).id;

    await user('cust', 'customer');
    await user('cust2', 'customer');
    // ~1 km away, great record
    await user('near', 'worker', { serviceLat: 24.928, serviceLng: 67.095, rating: 4.8 }, [plumbingId]);
    // ~4 km away
    await user('mid', 'worker', { serviceLat: 24.955, serviceLng: 67.09, rating: 4.2 }, [plumbingId]);
    // ~3 km away, but only travels 2 km
    await user('shortRange', 'worker', { serviceLat: 24.947, serviceLng: 67.09, serviceRadius: 2 }, [plumbingId]);
    // ~12 km away: outside a 10 km radius, inside 15 km after widening
    await user('far', 'worker', { serviceLat: 25.028, serviceLng: 67.09 }, [plumbingId]);
    // nearby but: offline / wrong trade / not approved / never works
    await user('offline', 'worker', { serviceLat: 24.921, serviceLng: 67.091, isOnline: false }, [plumbingId]);
    await user('sparky', 'worker', { serviceLat: 24.921, serviceLng: 67.091 }, [electricalId]);
    await user('pending', 'worker', { serviceLat: 24.921, serviceLng: 67.091, activationStatus: 'PENDING_REVIEW', isOnline: false }, [plumbingId]);
    await user('noHours', 'worker', { serviceLat: 24.921, serviceLng: 67.091, __hours: [] }, [plumbingId]);

    addressId = (await prisma.address.create({ data: { userId: ids.cust, streetAddress: 'House 12', city: 'Karachi', area: 'Gulshan', country: 'PK', latitude: HOME.lat, longitude: HOME.lng, isDefault: true } })).id;
    await prisma.address.create({ data: { userId: ids.cust2, streetAddress: 'House 9', city: 'Karachi', area: 'Gulshan', country: 'PK', latitude: HOME.lat, longitude: HOME.lng, isDefault: true } });
  });

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const createJob = async (who = 'cust', over: object = {}) => {
    const address = await prisma.address.findFirstOrThrow({ where: { userId: ids[who] } });
    const res = await http().post('/api/job-requests').set(as(who)).send({ categoryId: plumbingId, issueCodes: ['leaking_tap'], addressId: address.id, when: 'TODAY', idempotencyKey: key(), ...over }).expect(201);
    return res.body;
  };
  const matchedWorkers = async (jobId: string) =>
    (await prisma.jobMatch.findMany({ where: { jobRequestId: jobId }, orderBy: { rank: 'asc' } })).map((m) => Object.keys(ids).find((k) => ids[k] === m.workerId));

  describe('sweeper lease (one runner across instances)', () => {
    it('skips while another instance holds a live lease, runs once it lapses, and sweeps repeatedly', async () => {
      await prisma.$executeRaw`INSERT INTO "SchedulerLease" ("name", "holder", "expiresAt") VALUES ('sweeper', 'other-instance', ${new Date(Date.now() + 60_000)})
        ON CONFLICT ("name") DO UPDATE SET "holder" = 'other-instance', "expiresAt" = EXCLUDED."expiresAt"`;
      expect(await sweeper.sweep()).toBeNull();
      await prisma.$executeRaw`UPDATE "SchedulerLease" SET "expiresAt" = ${new Date(Date.now() - 1000)} WHERE "name" = 'sweeper'`;
      expect(await sweeper.sweep()).not.toBeNull();
      // Released after each run, so back-to-back sweeps (and other instances) keep working.
      for (let i = 0; i < 5; i++) expect(await sweeper.sweep()).not.toBeNull();
      expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "SchedulerLease" WHERE "name" = 'sweeper'`).toHaveLength(0);
    });

    it('two overlapping sweeps in one process: only one runs', async () => {
      const [a, b] = await Promise.all([sweeper.sweep(), sweeper.sweep()]);
      expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    });
  });

  describe('matching', () => {
    let jobId: string;

    it('tells only eligible professionals, nearest/best first, and records why', async () => {
      const job = await createJob();
      jobId = job.id;
      expect(await matchedWorkers(jobId)).toEqual(['near', 'mid']);
      expect(job.notifiedCount).toBe(2);
      expect(job.events.map((e: any) => e.type)).toEqual(['REQUEST_SENT', 'PROFESSIONALS_NOTIFIED']);
      const m = await prisma.jobMatch.findFirstOrThrow({ where: { jobRequestId: jobId, workerId: ids.near } });
      expect(m.distanceKm).toBeGreaterThan(0.5);
      expect(m.distanceKm).toBeLessThan(1.5);
    });

    it('only matched workers can see the request; others get 404', async () => {
      await http().get(`/api/job-requests/${jobId}`).set(as('near')).expect(200);
      for (const w of ['far', 'offline', 'sparky', 'shortRange', 'noHours']) {
        await http().get(`/api/job-requests/${jobId}`).set(as(w)).expect(404);
      }
    });

    it("appears in a matched worker's feed with distance, but no exact address", async () => {
      const feed = await http().get('/api/workers/me/requests').set(as('near')).expect(200);
      const item = feed.body.find((j: any) => j.id === jobId);
      expect(item).toMatchObject({ title: 'Leaking tap', area: 'Gulshan', city: 'Karachi', myOffer: null });
      expect(item.distanceKm).toBeLessThan(1.5);
      expect(JSON.stringify(item)).not.toMatch(/House 12|24\.92|67\.09/);
      const other = await http().get('/api/workers/me/requests').set(as('far')).expect(200);
      expect(other.body.find((j: any) => j.id === jobId)).toBeUndefined();
    });

    it('nobody responds: after the wait, the search widens once and reaches the farther worker', async () => {
      // pretend 20 minutes passed with no offers
      await prisma.jobRequest.update({ where: { id: jobId }, data: { lastMatchedAt: new Date(Date.now() - 20 * 60_000) } });
      const r = await sweeper.sweep();
      expect(r?.widened).toBeGreaterThanOrEqual(1);
      expect(await matchedWorkers(jobId)).toEqual(expect.arrayContaining(['near', 'mid', 'far']));
      const job = await http().get(`/api/job-requests/${jobId}`).set(as('cust')).expect(200);
      expect(job.body.matchRound).toBe(2);
      // and it never widens a third time
      await prisma.jobRequest.update({ where: { id: jobId }, data: { lastMatchedAt: new Date(Date.now() - 60 * 60_000) } });
      await sweeper.sweep();
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).matchRound).toBe(2);
    });

    it('a request with no GPS is matched by city', async () => {
      const addr = await prisma.address.create({ data: { userId: ids.cust2, streetAddress: 'No GPS', city: 'Karachi', country: 'PK' } });
      await prisma.worker.update({ where: { id: ids.mid }, data: { serviceAreaLabel: 'Nazimabad, Karachi' } });
      const job = (await http().post('/api/job-requests').set(as('cust2')).send({ categoryId: plumbingId, issueCodes: ['leaking_tap'], addressId: addr.id, when: 'TODAY', idempotencyKey: key() }).expect(201)).body;
      expect(await matchedWorkers(job.id)).toEqual(['mid']);
    });
  });

  describe('offers', () => {
    let jobId: string;
    let nearOffer: string;
    let midOffer: string;

    beforeAll(async () => { jobId = (await createJob()).id; });

    it('only matched, approved workers can send a price; money must be a positive whole number', async () => {
      await http().post(`/api/job-requests/${jobId}/offers`).set(as('far')).send({ amount: 150000 }).expect(404);
      await http().post(`/api/job-requests/${jobId}/offers`).set(as('cust')).send({ amount: 150000 }).expect(403);
      await http().post(`/api/job-requests/${jobId}/offers`).set(as('near')).send({ amount: 1500.5 }).expect(400);
      await http().post(`/api/job-requests/${jobId}/offers`).set(as('near')).send({ amount: -1 }).expect(400);
    });

    it('a worker can send, then change, their price; currency comes from their profile', async () => {
      const first = await http().post(`/api/job-requests/${jobId}/offers`).set(as('near')).send({ amount: 200000, etaMinutes: 45 }).expect(201);
      const revised = await http().post(`/api/job-requests/${jobId}/offers`).set(as('near')).send({ amount: 180000, etaMinutes: 30, note: 'I have the part' }).expect(201);
      expect(revised.body.id).toBe(first.body.id);
      expect(revised.body).toMatchObject({ amount: 180000, currency: 'PKR', status: 'PENDING' });
      nearOffer = revised.body.id;
      midOffer = (await http().post(`/api/job-requests/${jobId}/offers`).set(as('mid')).send({ amount: 150000, etaMinutes: 60 }).expect(201)).body.id;
      const feed = await http().get('/api/workers/me/requests').set(as('near')).expect(200);
      expect(feed.body.find((j: any) => j.id === jobId).myOffer).toMatchObject({ amount: 180000, status: 'PENDING' });
    });

    it('the customer sees the offers, best match first, with what they need to choose', async () => {
      const res = await http().get(`/api/job-requests/${jobId}/offers`).set(as('cust')).expect(200);
      expect(res.body.map((o: any) => o.id)).toEqual([nearOffer, midOffer]);
      expect(res.body[0]).toMatchObject({ amount: 180000, currency: 'PKR', etaMinutes: 30, note: 'I have the part', worker: { name: 'near Person', isVerified: true, jobsCompleted: 0 } });
      expect(res.body[0].worker.distanceKm).toBeLessThan(1.5);
      expect(JSON.stringify(res.body)).not.toMatch(/@t\.com|phone/);
    });

    it("other customers and workers can't read the offers", async () => {
      await http().get(`/api/job-requests/${jobId}/offers`).set(as('cust2')).expect(404);
      await http().get(`/api/job-requests/${jobId}/offers`).set(as('near')).expect(403);
    });

    it('"not for me" hides the request and withdraws the price', async () => {
      const j2 = (await createJob()).id;
      await http().post(`/api/job-requests/${j2}/offers`).set(as('mid')).send({ amount: 100000 }).expect(201);
      await http().post(`/api/job-requests/${j2}/not-interested`).set(as('mid')).expect(201);
      const feed = await http().get('/api/workers/me/requests').set(as('mid')).expect(200);
      expect(feed.body.find((j: any) => j.id === j2)).toBeUndefined();
      expect((await http().get(`/api/job-requests/${j2}/offers`).set(as('cust')).expect(200)).body).toEqual([]);
      await http().post(`/api/job-requests/${j2}/offers`).set(as('mid')).send({ amount: 90000 }).expect(409);
    });

    it('expired prices are not shown and cannot be accepted', async () => {
      const j3 = (await createJob()).id;
      const o = (await http().post(`/api/job-requests/${j3}/offers`).set(as('near')).send({ amount: 120000 }).expect(201)).body;
      await prisma.offer.update({ where: { id: o.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await http().get(`/api/job-requests/${j3}/offers`).set(as('cust')).expect(200)).body).toEqual([]);
      const r = await http().post(`/api/offers/${o.id}/accept`).set(as('cust')).expect(409);
      expect(r.body.error.code).toBe('OFFER_EXPIRED');
      await sweeper.sweep();
      expect((await prisma.offer.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('EXPIRED');
    });
  });

  describe('booking', () => {
    it('choosing a price books the job at that price; the others are told no; the worker gets the address', async () => {
      const jobId = (await createJob('cust', { when: 'TOMORROW', timeSlot: 'MORNING' })).id;
      const a = (await http().post(`/api/job-requests/${jobId}/offers`).set(as('near')).send({ amount: 175000 }).expect(201)).body;
      const b = (await http().post(`/api/job-requests/${jobId}/offers`).set(as('mid')).send({ amount: 160000 }).expect(201)).body;

      await http().post(`/api/offers/${a.id}/accept`).set(as('cust2')).expect(404); // not their job
      const res = await http().post(`/api/offers/${a.id}/accept`).set(as('cust')).expect(201);
      expect(res.body).toMatchObject({ status: 'ACCEPTED', workerId: ids.near, amount: 175000, currency: 'PKR' });

      const job = await http().get(`/api/job-requests/${jobId}`).set(as('cust')).expect(200);
      expect(job.body).toMatchObject({ status: 'ACCEPTED', assignedWorkerId: ids.near, agreedAmount: 175000, agreedCurrency: 'PKR' });
      expect(job.body.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['OFFER_RECEIVED', 'OFFER_ACCEPTED']));
      expect((await prisma.offer.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('REJECTED');

      const forWorker = await http().get(`/api/job-requests/${jobId}`).set(as('near')).expect(200);
      expect(forWorker.body.location).toContain('House 12');
      await http().get(`/api/job-requests/${jobId}`).set(as('mid')).expect(404); // no longer open to them

      // cannot be accepted twice, and the losing worker cannot re-price it
      await http().post(`/api/offers/${b.id}/accept`).set(as('cust')).expect(409);
      const late = await http().post(`/api/job-requests/${jobId}/offers`).set(as('mid')).send({ amount: 1000 }).expect(409);
      expect(late.body.error.code).toBe('REQUEST_CLOSED');
    });

    it('two simultaneous acceptances on the same request: exactly one wins', async () => {
      const jobId = (await createJob('cust', { when: 'TOMORROW', timeSlot: 'AFTERNOON' })).id;
      const a = (await http().post(`/api/job-requests/${jobId}/offers`).set(as('near')).send({ amount: 100000 }).expect(201)).body;
      const b = (await http().post(`/api/job-requests/${jobId}/offers`).set(as('mid')).send({ amount: 110000 }).expect(201)).body;
      const codes = (await Promise.all([
        http().post(`/api/offers/${a.id}/accept`).set(as('cust')),
        http().post(`/api/offers/${b.id}/accept`).set(as('cust')),
      ])).map((r) => r.status).sort();
      expect(codes).toEqual([201, 409]);
      const job = await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } });
      expect(await prisma.offer.count({ where: { jobRequestId: jobId, status: 'ACCEPTED' } })).toBe(1);
      expect([ids.near, ids.mid]).toContain(job.assignedWorkerId);
    });

    it('a worker cannot be double-booked for overlapping times, even by two customers at once', async () => {
      const j1 = (await createJob('cust', { when: 'TOMORROW', timeSlot: 'EVENING' })).id;
      const j2 = (await createJob('cust2', { when: 'TOMORROW', timeSlot: 'EVENING' })).id;
      const o1 = (await http().post(`/api/job-requests/${j1}/offers`).set(as('near')).send({ amount: 90000 }).expect(201)).body;
      const o2 = (await http().post(`/api/job-requests/${j2}/offers`).set(as('near')).send({ amount: 95000 }).expect(201)).body;
      const results = await Promise.all([
        http().post(`/api/offers/${o1.id}/accept`).set(as('cust')),
        http().post(`/api/offers/${o2.id}/accept`).set(as('cust2')),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('WORKER_BUSY');
    });

    it('a different time slot the same day is fine', async () => {
      const j = (await createJob('cust2', { when: 'SCHEDULED', date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), timeSlot: 'MORNING' })).id;
      const o = (await http().post(`/api/job-requests/${j}/offers`).set(as('near')).send({ amount: 80000 }).expect(201)).body;
      await http().post(`/api/offers/${o.id}/accept`).set(as('cust2')).expect(201);
    });
  });
});
