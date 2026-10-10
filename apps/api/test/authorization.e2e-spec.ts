import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { seedCatalog } from '../prisma/seed-catalog';

/**
 * Horizontal / vertical privilege checks against a real database.
 * Users are created directly (not via /auth) so the auth rate limit is not consumed.
 */
describe('Authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `authz${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const http = () => request(app.getHttpServer());

  async function makeUser(key: string, type: 'customer' | 'worker' | 'admin') {
    const user = await prisma.user.create({
      data: {
        name: `${key} user`,
        email: `${tag}-${key}@test.com`,
        password: await bcrypt.hash('password123', 4),
        type,
        ...(type === 'admin' ? { adminRoles: ['Super Admin'] } : {}),
      },
    });
    if (type === 'worker') {
      // A genuinely matchable worker: approved, online, Karachi, plumbing + electrical, works every day.
      const cats = await prisma.serviceCategory.findMany({ where: { name: { in: ['PLUMBING', 'ELECTRICAL'] } }, select: { id: true } });
      await prisma.worker.create({
        data: {
          id: user.id, activationStatus: 'ACTIVE', isVerified: true, isOnline: true, serviceAreaLabel: 'Karachi',
          services: { create: cats.map((c) => ({ categoryId: c.id })) },
          workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) },
        },
      });
    }
    const session = await prisma.session.create({
      data: { userId: user.id, deviceId: `device-${key}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) },
    });
    ids[key] = user.id;
    tokens[key] = jwt.sign({ sub: user.id, type, sid: session.id });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    await app.listen(0); // one real listener: supertest otherwise opens a new server per request and flakes under load
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await seedCatalog(prisma as any);

    await makeUser('custA', 'customer');
    await makeUser('custB', 'customer');
    await makeUser('workW1', 'worker');
    await makeUser('workW2', 'worker');
    await makeUser('admin', 'admin');

    plumbingId = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    electricalId = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'ELECTRICAL' } })).id;
    for (const who of ['custA', 'custB']) {
      addressIds[who] = (await prisma.address.create({
        data: { userId: ids[who], streetAddress: `House 1 ${who}`, city: 'Karachi', area: 'Gulshan', country: 'PK', isDefault: true },
      })).id;
    }
  });

  let plumbingId: string;
  let electricalId: string;
  const addressIds: Record<string, string> = {};
  let keyN = 0;
  const jobBody = (who: string, categoryId: string, issue: string) => ({
    categoryId, issueCodes: [issue], addressId: addressIds[who], when: 'TODAY', idempotencyKey: `${tag}-key-${++keyN}`,
  });

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.review.deleteMany({ where: { reviewerId: { in: userIds } } });
    await prisma.quote.deleteMany({ where: { jobRequest: { customerId: { in: userIds } } } });
    await prisma.dispute.deleteMany({ where: { raisedById: { in: userIds } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  let jobId: string;

  describe('anonymous access', () => {
    it('health and catalog are public', async () => {
      await http().get('/api/health').expect(200);
      await http().get('/api/service-catalog/categories').expect(200);
    });
    it.each(['/api/users', '/api/workers', '/api/job-requests', '/api/disputes/all', '/api/conversations'])(
      '%s needs a token',
      (path) => http().get(path).expect(401),
    );
  });

  describe('roles', () => {
    it('only admins can list users', async () => {
      await http().get('/api/users').set(as('custA')).expect(403);
      await http().get('/api/users').set(as('workW1')).expect(403);
      await http().get('/api/users').set(as('admin')).expect(200);
    });
    it('a user cannot read another user', async () => {
      await http().get(`/api/users/${ids.custB}`).set(as('custA')).expect(404);
      await http().get(`/api/users/${ids.custA}`).set(as('custA')).expect(200);
    });
    it('workers cannot create jobs; customers can', async () => {
      await http()
        .post('/api/job-requests')
        .set(as('workW1'))
        .send(jobBody('custA', plumbingId, 'leaking_tap'))
        .expect(403);
    });
  });

  describe('job data isolation and state machine', () => {
    it('customer A creates a job', async () => {
      const res = await http()
        .post('/api/job-requests')
        .set(as('custA'))
        .send(jobBody('custA', plumbingId, 'leaking_tap'))
        .expect(201);
      jobId = res.body.id;
      expect(res.body.customerId).toBe(ids.custA);
    });

    it("cannot use someone else's saved address", async () => {
      const res = await http().post('/api/job-requests').set(as('custB')).send({ ...jobBody('custB', plumbingId, 'leaking_tap'), addressId: addressIds.custA }).expect(400);
      expect(res.body.error.code).toBe('INVALID_ADDRESS');
    });

    it('customer B cannot see, edit or cancel it, and it is absent from their list', async () => {
      await http().get(`/api/job-requests/${jobId}`).set(as('custB')).expect(404);
      await http().patch(`/api/job-requests/${jobId}`).set(as('custB')).send({ description: 'hijacked job text' }).expect(404);
      await http().post(`/api/job-requests/${jobId}/cancel`).set(as('custB')).expect(404);
      const list = await http().get('/api/job-requests').set(as('custB')).expect(200);
      expect(list.body.items.find((j: any) => j.id === jobId)).toBeUndefined();
    });

    it('a worker sees the open job but never the customer email', async () => {
      const res = await http().get(`/api/job-requests/${jobId}`).set(as('workW1')).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(`${tag}-custA@test.com`);
    });

    it('clients cannot set status, price or worker through PATCH', async () => {
      for (const body of [{ status: 'COMPLETED' }, { paymentAmount: 1 }, { assignedWorkerId: ids.workW1 }]) {
        const res = await http().patch(`/api/job-requests/${jobId}`).set(as('custA')).send(body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('error responses use the standard envelope with a request id', async () => {
      const res = await http().get('/api/job-requests/nope').set(as('custA')).expect(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      expect(res.body.error.requestId).toMatch(/^req_|^[A-Za-z0-9._-]+$/);
    });

    it('a worker cannot accept or complete a job nobody assigned to them', async () => {
      await http().post(`/api/job-requests/${jobId}/accept`).set(as('workW1')).expect(404);
      await http().post(`/api/job-requests/${jobId}/complete`).set(as('workW1')).expect(404);
    });

    it('customer chooses W1; W2 still cannot touch it', async () => {
      await http().post(`/api/job-requests/${jobId}/request-worker`).set(as('custA')).send({ workerId: ids.workW1 }).expect(201);
      await http().post(`/api/job-requests/${jobId}/accept`).set(as('workW2')).expect(404);
      await http().get(`/api/job-requests/${jobId}`).set(as('workW2')).expect(404);
    });

    it('cannot skip steps: complete before start is rejected', async () => {
      await http().post(`/api/job-requests/${jobId}/accept`).set(as('workW1')).expect(201);
      const res = await http().post(`/api/job-requests/${jobId}/complete`).set(as('workW1')).expect(400);
      expect(res.body.error.code).toBe('ILLEGAL_JOB_TRANSITION');
    });

    it('only one of two simultaneous accepts can win', async () => {
      const second = await http().post('/api/job-requests').set(as('custB')).send(jobBody('custB', electricalId, 'no_power')).expect(201);
      await http().post(`/api/job-requests/${second.body.id}/request-worker`).set(as('custB')).send({ workerId: ids.workW1 }).expect(201);
      const results = await Promise.all([
        http().post(`/api/job-requests/${second.body.id}/accept`).set(as('workW1')),
        http().post(`/api/job-requests/${second.body.id}/accept`).set(as('workW1')),
      ]);
      // exactly one wins; the loser is refused (409 if it lost mid-update, 400 if the job had already moved on)
      const codes = results.map((r) => r.status).sort();
      expect(codes[0]).toBe(201);
      expect([400, 409]).toContain(codes[1]);
    });
  });

  describe('quotes, reviews, disputes', () => {
    it('customers cannot create quotes; non-assigned workers cannot either', async () => {
      await http().post('/api/quotes').set(as('custA')).send({ jobRequestId: jobId, totalAmount: 5000 }).expect(403);
      await http().post('/api/quotes').set(as('workW2')).send({ jobRequestId: jobId, totalAmount: 5000 }).expect(404);
    });

    it('quote status is forced to PENDING and money must be a positive integer', async () => {
      await http().post('/api/quotes').set(as('workW1')).send({ jobRequestId: jobId, totalAmount: 12.5 }).expect(400);
      await http().post('/api/quotes').set(as('workW1')).send({ jobRequestId: jobId, totalAmount: 5000, status: 'APPROVED' }).expect(400);
      const ok = await http().post('/api/quotes').set(as('workW1')).send({ jobRequestId: jobId, totalAmount: 5000 }).expect(201);
      expect(ok.body.status).toBe('PENDING');
    });

    it('other customers cannot read or decide quotes on my job', async () => {
      await http().get(`/api/quotes/job/${jobId}`).set(as('custB')).expect(404);
      await http().get(`/api/quotes/job/${jobId}`).set(as('workW2')).expect(404);
      const quotes = await http().get(`/api/quotes/job/${jobId}`).set(as('custA')).expect(200);
      await http().patch(`/api/quotes/${quotes.body[0].id}/status`).set(as('custB')).send({ status: 'APPROVED' }).expect(404);
    });

    it('reviews need a completed job, a valid rating, and happen once', async () => {
      await http().post('/api/reviews').set(as('custA')).send({ jobRequestId: jobId, rating: 5 }).expect(409);
      await prisma.jobRequest.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
      await http().post('/api/reviews').set(as('custA')).send({ jobRequestId: jobId, rating: 6 }).expect(400);
      await http().post('/api/reviews').set(as('custB')).send({ jobRequestId: jobId, rating: 5 }).expect(404);
      await http().post('/api/reviews').set(as('custA')).send({ jobRequestId: jobId, rating: 4 }).expect(201);
      await http().post('/api/reviews').set(as('custA')).send({ jobRequestId: jobId, rating: 1 }).expect(409);
      const worker = await prisma.worker.findUnique({ where: { id: ids.workW1 } });
      expect(worker?.rating).toBe(4);
    });

    it('only participants can open or read a dispute', async () => {
      await http().post('/api/disputes').set(as('custB')).send({ jobRequestId: jobId, reason: 'Not my job' }).expect(404);
      const d = await http().post('/api/disputes').set(as('custA')).send({ jobRequestId: jobId, reason: 'Poor work' }).expect(201);
      await http().get(`/api/disputes/${d.body.id}`).set(as('custB')).expect(404);
      await http().get(`/api/disputes/${d.body.id}`).set(as('workW1')).expect(200);
      await http().patch(`/api/disputes/${d.body.id}/resolve`).set(as('custA')).send({ status: 'RESOLVED' }).expect(403);
      await http().patch(`/api/disputes/${d.body.id}/resolve`).set(as('admin')).send({ status: 'RESOLVED', resolution: 'Refunded' }).expect(200);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Dispute', entityId: d.body.id, action: 'dispute.updated' } });
      expect(audit?.actorId).toBe(ids.admin);
    });
  });

  describe('worker privacy', () => {
    it('public worker endpoints never expose email or home address', async () => {
      const list = await http().get('/api/workers').set(as('custA')).expect(200);
      const one = await http().get(`/api/workers/${ids.workW1}`).set(as('custA')).expect(200);
      for (const body of [list.body, one.body]) {
        expect(JSON.stringify(body)).not.toMatch(/@test\.com|homeAddress|"email"/);
      }
    });
    it('there is no way to edit another worker: profile edits only exist on /workers/me', async () => {
      await http().patch(`/api/workers/${ids.workW1}`).set(as('workW2')).send({ bio: 'defaced' }).expect(404);
      await http().patch('/api/workers/me').set(as('workW2')).send({ bio: 'my own bio' }).expect(200);
      const other = await prisma.worker.findUnique({ where: { id: ids.workW1 } });
      expect(other?.bio).not.toBe('my own bio');
    });
    it('a worker cannot grant themselves verification, rating or activation', async () => {
      for (const body of [{ isVerified: true }, { rating: 5 }, { activationStatus: 'ACTIVE' }]) {
        await http().patch('/api/workers/me').set(as('workW2')).send(body).expect(400);
      }
    });
    it('customers cannot use worker profile endpoints', async () => {
      await http().get('/api/workers/me').set(as('custA')).expect(403);
      await http().patch('/api/workers/me').set(as('custA')).send({ bio: 'x' }).expect(403);
    });
  });

  describe('rate limiting', () => {
    it('login is throttled', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 14; i++) {
        const r = await http().post('/api/auth/login').send({ phone: '0300 1234567', countryCode: 'PK', password: 'wrong-password', deviceId: 'device-throttle' });
        codes.push(r.status);
      }
      expect(codes).toContain(429);
    });
  });
});
