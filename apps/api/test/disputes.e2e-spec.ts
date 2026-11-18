import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/** Disputes and favourites against a real database (doc 27 R6). */
describe('Disputes & favourites (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `dsp${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (k: string) => ({ Authorization: `Bearer ${tokens[k]}` });
  const http = () => request(app.getHttpServer());
  let n = 0;
  let jobId: string;

  async function user(k: string, type: 'customer' | 'worker') {
    const u = await prisma.user.create({
      data: { name: `${k} Person`, phone: `+9232${String(Date.now()).slice(-7)}${++n}`.slice(0, 13), password: await bcrypt.hash('x-Pass-123', 4), type, countryCode: 'PK' } as any,
    });
    if (type === 'worker') await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', isVerified: true } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3_600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await user('cust', 'customer'); await user('work', 'worker'); await user('other', 'customer');
    const job = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'cust', assignedWorkerId: ids.work, description: 'Fix tap', location: 'x', latitude: 24.9, longitude: 67.1, area: 'Gulshan', city: 'Karachi', status: 'COMPLETED' } as any });
    jobId = job.id;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  describe('disputes', () => {
    it('rejects a client-supplied held amount, evidence keys or unknown category', async () => {
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: jobId, reason: 'Bad work', amountHeld: 999999 }).expect(400);
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: jobId, reason: 'Bad work', evidenceKeys: ['uploads/someone-else.jpg'] }).expect(400);
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: jobId, reason: 'Bad work', category: 'WHATEVER' }).expect(400);
    });

    it('a non-participant cannot open one', async () => {
      const res = await http().post('/api/disputes').set(as('other')).send({ jobRequestId: jobId, reason: 'Not mine' });
      expect([403, 404]).toContain(res.status);
    });

    let disputeId: string;
    it('a participant opens one; a second open report on the same job is refused with the existing id', async () => {
      const ok = await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: jobId, category: 'QUALITY', reason: 'Tap still leaks', description: 'Came back the next day' }).expect(201);
      disputeId = ok.body.id;
      expect(ok.body).toMatchObject({ status: 'OPEN', category: 'QUALITY', raisedById: ids.cust });
      const again = await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: jobId, reason: 'Tap still leaks' }).expect(409);
      expect(JSON.stringify(again.body)).toContain('DISPUTE_EXISTS');
      expect(JSON.stringify(again.body)).toContain(disputeId);
    });

    it('lists my disputes; the other party can read but a stranger cannot', async () => {
      const mine = await http().get('/api/disputes/my-disputes').set(as('cust')).expect(200);
      expect(mine.body.map((d: any) => d.id)).toContain(disputeId);
      const theirs = await http().get('/api/disputes/my-disputes').set(as('work')).expect(200);
      expect(theirs.body.map((d: any) => d.id)).not.toContain(disputeId);
      await http().get(`/api/disputes/${disputeId}`).set(as('work')).expect(200);
      await http().get(`/api/disputes/${disputeId}`).set(as('other')).expect(404);
    });

    it('the worker can open their own report on the same job', async () => {
      await http().post('/api/disputes').set(as('work')).send({ jobRequestId: jobId, category: 'BEHAVIOUR', reason: 'Customer was rude' }).expect(201);
    });
  });

  describe('favourites', () => {
    it('add is idempotent, list shows the worker, remove works, unknown worker is 404', async () => {
      await http().post(`/api/users/me/favorites/${ids.work}`).set(as('cust')).expect(201);
      await http().post(`/api/users/me/favorites/${ids.work}`).set(as('cust')).expect(201);
      const list = await http().get('/api/users/me/favorites').set(as('cust')).expect(200);
      expect(list.body).toHaveLength(1);
      await http().post('/api/users/me/favorites/does-not-exist').set(as('cust')).expect(404);
      await http().delete(`/api/users/me/favorites/${ids.work}`).set(as('cust')).expect(200);
      expect((await http().get('/api/users/me/favorites').set(as('cust')).expect(200)).body).toHaveLength(0);
    });
  });

  describe('data export', () => {
    it('returns my own data, with the other side and secrets left out', async () => {
      const c = await http().get('/api/users/me/export').set(as('cust')).expect(200);
      expect(c.body.account.id).toBe(ids.cust);
      expect(c.body.jobs.map((j: any) => j.id)).toContain(jobId);
      expect(c.body.jobs[0].yourRole).toBe('customer');
      expect(JSON.stringify(c.body)).not.toMatch(/password|refreshToken/i);
      expect(JSON.stringify(c.body)).not.toContain(ids.work); // the professional's id is not in the customer's export

      const w = await http().get('/api/users/me/export').set(as('work')).expect(200);
      expect(w.body.jobs[0].yourRole).toBe('professional');
      expect(w.body.professionalProfile).toBeDefined();

      // A third person's export never contains either of them. (The limit is 3 per hour per client, so this is the last call.)
      const o = await http().get('/api/users/me/export').set(as('other')).expect(200);
      expect(o.body.jobs).toEqual([]);
      expect(JSON.stringify(o.body)).not.toContain(ids.cust);
    });
  });
});
