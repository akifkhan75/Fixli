import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { JobLifecycleSweeper } from '../src/jobs/job-lifecycle.sweeper';
import { NotificationService } from '../src/notifications/notifications.service';

/** doc 27 F3: money is correct, consistent and idempotent. */
describe('Money: cash, ledger, limits, settlements, disputes (doc 27 F3, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `money${Date.now()}`;
  const suffix = String(Date.now()).slice(-6);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let n = 0;

  async function user(k: string, type: 'customer' | 'worker' | 'admin', adminRoles: string[] = []) {
    const u = await prisma.user.create({
      data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone: type === 'admin' ? null : `+92302${suffix}${n++}`, password: await bcrypt.hash('blue-Tiger-42', 4), type, countryCode: 'PK', adminRoles },
    });
    if (type === 'worker') await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true, currency: 'PKR' } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }
  const job = async (worker = 'pro', amount = 250_000, status = 'AWAITING_CONFIRMATION', customer = 'cust') =>
    (await prisma.jobRequest.create({ data: { customerId: ids[customer], customerName: customer, description: 'Leaking tap', title: 'Leaking tap', status: status as any, assignedWorkerId: ids[worker], agreedAmount: amount, agreedCurrency: 'PKR', finishedAt: new Date() } })).id;
  const balance = async (w = 'pro') => (await prisma.worker.findUniqueOrThrow({ where: { id: ids[w] } })).ledgerBalance;
  const types = async (k: string) => { await app.get(NotificationService).idle(); return (await prisma.notification.findMany({ where: { userId: ids[k] } })).map((x) => x.type); };
  const markAndConfirm = async (jobId: string, worker = 'pro', customer = 'cust') => {
    const p = await http().post(`/api/job-requests/${jobId}/payments/cash`).set(as(worker));
    if (p.status !== 201) throw new Error(`mark ${p.status} ${JSON.stringify(p.body)}`);
    const c = await http().post(`/api/payments/${p.body.id}/confirm`).set(as(customer));
    if (c.status !== 200) throw new Error(`confirm ${c.status} ${JSON.stringify(c.body)}`);
    return p.body.id as string;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    for (const [k, t] of [['cust', 'customer'], ['cust2', 'customer'], ['pro', 'worker'], ['pro2', 'worker'], ['big', 'worker']] as const) await user(k, t);
    await user('finance', 'admin', ['Finance']);
    await user('verifier', 'admin', ['Verification']);
  }, 60_000);

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.settlement.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.review.deleteMany({ where: { reviewerId: { in: userIds } } });
    await prisma.dispute.deleteMany({ where: { raisedById: { in: userIds } } });
    await prisma.payment.deleteMany({ where: { jobRequest: { customerId: { in: userIds } } } });
    await prisma.favoriteWorker.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  describe('cash', () => {
    let jobId: string;
    let paymentId: string;
    beforeAll(async () => { jobId = await job(); });

    it('the worker marks the agreed total; the amount can\'t be typed; a second tap changes nothing', async () => {
      await http().post(`/api/job-requests/${jobId}/payments/cash`).set(as('pro')).send({ amount: 1 }).expect(400);
      await http().post(`/api/job-requests/${jobId}/payments/cash`).set(as('cust')).expect(403);
      const a = await http().post(`/api/job-requests/${jobId}/payments/cash`).set(as('pro')).expect(201);
      const b = await http().post(`/api/job-requests/${jobId}/payments/cash`).set(as('pro')).expect(201);
      expect(a.body).toMatchObject({ amount: 250_000, currency: 'PKR', status: 'MARKED_BY_WORKER' });
      expect(b.body.id).toBe(a.body.id);
      paymentId = a.body.id;
      expect(await types('cust')).toContain('payment.cash_marked');
    });

    it('five simultaneous confirmations book the commission exactly once (12 % = Rs 300)', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => http().post(`/api/payments/${paymentId}/confirm`).set(as('cust'))));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const entries = await prisma.ledgerEntry.findMany({ where: { workerId: ids.pro } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: 'COMMISSION_OWED', amount: 30_000, balanceAfter: 30_000, idempotencyKey: `commission:${jobId}` });
      expect(await balance()).toBe(30_000);
      expect(await types('pro')).toContain('payment.confirmed');
    });

    it('earnings: earned is the cash, commission is separate, and what is owed is shown', async () => {
      const e = await http().get('/api/workers/me/earnings?period=week').set(as('pro')).expect(200);
      expect(e.body).toMatchObject({ currency: 'PKR', period: 'week', gross: 250_000, commission: 30_000, net: 220_000, jobs: 1, owed: 30_000, limits: { overSoft: false, blocked: false } });
      expect(e.body.today).toMatchObject({ gross: 250_000, commission: 30_000 });
      expect(e.body.settlementRails.map((r: any) => r.id)).toEqual(['JAZZCASH', 'EASYPAISA', 'BANK']);
      const l = await http().get('/api/workers/me/ledger?limit=1').set(as('pro')).expect(200);
      expect(l.body.items[0]).toMatchObject({ type: 'COMMISSION_OWED', amount: 30_000, jobTitle: 'Leaking tap' });
      await http().get('/api/workers/me/earnings').set(as('cust')).expect(403);
    });

    it('the floor and ceiling apply (Rs 100 min, Rs 1,500 max)', async () => {
      await markAndConfirm(await job('pro2', 50_000), 'pro2');
      expect(await balance('pro2')).toBe(10_000);
      await markAndConfirm(await job('pro2', 5_000_000), 'pro2');
      expect(await balance('pro2')).toBe(160_000);
    });

    it('unanswered cash is confirmed automatically after 48 h (commission once); fresh cash is left alone', async () => {
      const old = await job('pro2', 100_000);
      const p = await http().post(`/api/job-requests/${old}/payments/cash`).set(as('pro2')).expect(201);
      await prisma.payment.update({ where: { id: p.body.id }, data: { markedAt: new Date(Date.now() - 49 * 3600_000) } });
      const fresh = await job('pro2', 100_000);
      await http().post(`/api/job-requests/${fresh}/payments/cash`).set(as('pro2')).expect(201);
      const r = await app.get(JobLifecycleSweeper).sweep();
      expect(r?.cashAutoConfirmed).toBe(1);
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.body.id } })).toMatchObject({ status: 'CONFIRMED', autoConfirmed: true });
      expect(await balance('pro2')).toBe(160_000 + 12_000);
      expect(await types('pro2')).toContain('payment.auto_confirmed');
    });
  });

  describe('limits pause new work until settled', () => {
    it('crossing the hard limit (Rs 5,000) stops new prices and matching, and says why', async () => {
      for (let i = 0; i < 4; i++) await markAndConfirm(await job('big', 5_000_000), 'big'); // 4 × Rs 1,500
      expect(await balance('big')).toBe(600_000);
      expect((await prisma.worker.findUniqueOrThrow({ where: { id: ids.big } })).balanceBlocked).toBe(true);
      expect(await types('big')).toContain('balance.paused');
      const e = await http().get('/api/workers/me/earnings').set(as('big')).expect(200);
      expect(e.body.limits).toMatchObject({ overSoft: true, blocked: true });

      const open = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', description: 'Fan', status: 'MATCHES_FOUND' } });
      await prisma.jobMatch.create({ data: { jobRequestId: open.id, workerId: ids.big, round: 1, rank: 1, score: 1 } });
      const r = await http().post(`/api/job-requests/${open.id}/offers`).set(as('big')).send({ amount: 100_000 }).expect(403);
      expect(r.body.error.code).toBe('COMMISSION_LIMIT');
    });

    it('settling: reported, checked by Finance only, then the balance drops and work resumes', async () => {
      await http().post('/api/workers/me/settlements').set(as('big')).send({ amount: 900_000, rail: 'JAZZCASH', reference: 'TX-1' }).expect(400);
      await http().post('/api/workers/me/settlements').set(as('big')).send({ amount: 200_000, rail: 'WESTERN', reference: 'TX-1' }).expect(400);
      const s = await http().post('/api/workers/me/settlements').set(as('big')).send({ amount: 200_000, rail: 'JAZZCASH', reference: 'JC-778812' }).expect(201);
      await http().post('/api/workers/me/settlements').set(as('big')).send({ amount: 1000, rail: 'JAZZCASH', reference: 'JC-2' }).expect(409);
      expect(await balance('big')).toBe(600_000); // nothing changes until checked

      await http().post(`/api/admin/v1/settlements/${s.body.id}/confirm`).set(as('verifier')).send({}).expect(403);
      await http().post(`/api/admin/v1/settlements/${s.body.id}/confirm`).set(as('finance')).send({ note: 'Seen in JazzCash' }).expect(200);
      await http().post(`/api/admin/v1/settlements/${s.body.id}/confirm`).set(as('finance')).send({}).expect(409);
      expect(await balance('big')).toBe(400_000);
      expect((await prisma.worker.findUniqueOrThrow({ where: { id: ids.big } })).balanceBlocked).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: 'settlement.confirmed', entityId: s.body.id } })).toBe(1);
      expect(await types('big')).toContain('settlement.confirmed');
    });

    it('a rejected settlement changes nothing and tells the worker why', async () => {
      const s = await http().post('/api/workers/me/settlements').set(as('big')).send({ amount: 100_000, rail: 'BANK', reference: 'HBL-1' }).expect(201);
      await http().post(`/api/admin/v1/settlements/${s.body.id}/reject`).set(as('finance')).send({ note: 'No transfer with that reference' }).expect(200);
      expect(await balance('big')).toBe(400_000);
      expect(await types('big')).toContain('settlement.rejected');
    });
  });

  describe('disputes', () => {
    it('"I didn\'t pay that": no commission; support decides (void = no fee, confirm = fee once)', async () => {
      const voidJob = await job('pro', 100_000);
      const p1 = await http().post(`/api/job-requests/${voidJob}/payments/cash`).set(as('pro')).expect(201);
      const d1 = await http().post(`/api/payments/${p1.body.id}/dispute`).set(as('cust')).send({ reason: 'I never paid cash' }).expect(200);
      await http().post(`/api/payments/${p1.body.id}/confirm`).set(as('cust')).expect(409);
      expect(await types('pro')).toContain('payment.disputed');
      const before = await balance();
      await http().patch(`/api/disputes/${d1.body.disputeId}/resolve`).set(as('finance')).send({ status: 'RESOLVED', resolution: 'No payment was made', paymentOutcome: 'VOID' }).expect(200);
      expect(await balance()).toBe(before);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: p1.body.id } })).status).toBe('VOIDED');

      const okJob = await job('pro', 100_000);
      const p2 = await http().post(`/api/job-requests/${okJob}/payments/cash`).set(as('pro')).expect(201);
      const d2 = await http().post(`/api/payments/${p2.body.id}/dispute`).set(as('cust')).send({ reason: 'Amount was less' }).expect(200);
      await http().patch(`/api/disputes/${d2.body.disputeId}/resolve`).set(as('finance')).send({ status: 'RESOLVED', paymentOutcome: 'CONFIRM' }).expect(200);
      expect(await balance()).toBe(before + 12_000);
      await http().patch(`/api/disputes/${d2.body.disputeId}/resolve`).set(as('finance')).send({ status: 'CLOSED' }).expect(409); // closed stays closed
    });

    it('one open dispute per job; amount ≤ price; fixed categories; the other side is told', async () => {
      const j = await job('pro2', 100_000);
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: j, reason: 'Leak is back', category: 'MADE_UP' }).expect(400);
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: j, reason: 'Leak is back', amountHeld: 999_999 }).expect(400);
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: j, reason: 'Leak is back', category: 'QUALITY', amountHeld: 50_000 }).expect(201);
      await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: j, reason: 'Again' }).expect(409);
      expect(await types('pro2')).toContain('dispute.opened');
    });

    it('a ledger correction needs finance.adjust', async () => {
      const j = await job('pro2', 100_000);
      const d = await http().post('/api/disputes').set(as('cust')).send({ jobRequestId: j, reason: 'Overcharged', category: 'PRICE' }).expect(201);
      await user('ops', 'admin', ['Operations']);
      await http().patch(`/api/disputes/${d.body.id}/resolve`).set(as('ops')).send({ status: 'RESOLVED', ledgerAdjustment: { amount: -5000, note: 'Goodwill' } }).expect(403);
      const before = await balance('pro2');
      await http().patch(`/api/disputes/${d.body.id}/resolve`).set(as('finance')).send({ status: 'RESOLVED', ledgerAdjustment: { amount: -5000, note: 'Goodwill credit' } }).expect(200);
      expect(await balance('pro2')).toBe(before - 5000);
    });
  });

  describe('reviews and favourites', () => {
    it('tags must fit the person reviewed; customer ratings are private', async () => {
      const j = await job('pro', 100_000, 'COMPLETED');
      await http().post('/api/reviews').set(as('cust')).send({ jobRequestId: j, rating: 5, tags: ['PAID_PROMPTLY'] }).expect(400);
      await http().post('/api/reviews').set(as('cust')).send({ jobRequestId: j, rating: 5, tags: ['NOT_A_TAG'] }).expect(400);
      await http().post('/api/reviews').set(as('cust')).send({ jobRequestId: j, rating: 5, tags: ['ON_TIME', 'SKILLED'] }).expect(201);
      await http().post('/api/reviews').set(as('pro')).send({ jobRequestId: j, rating: 2, tags: ['PAID_PROMPTLY'] }).expect(201);
      const pub = await http().get(`/api/reviews/user/${ids.cust}`).set(as('pro2')).expect(200);
      expect(pub.body).toEqual([]);
      const forWorker = await http().get(`/api/reviews/user/${ids.pro}`).set(as('cust2')).expect(200);
      expect(forWorker.body[0]).toMatchObject({ rating: 5, tags: ['ON_TIME', 'SKILLED'] });
    });

    it('favouriting an unknown professional is a 404, not a server error', async () => {
      await http().post('/api/users/me/favorites/not-a-worker').set(as('cust')).expect(404);
      await http().post(`/api/users/me/favorites/${ids.pro}`).set(as('cust')).expect(201);
    });
  });

  describe('account deletion', () => {
    it('refused with the wrong password, while owing commission, or during an active job', async () => {
      await http().post('/api/users/me/delete').set(as('cust2')).send({ password: 'wrong' }).expect(401);
      await user('debtor', 'worker');
      await prisma.worker.update({ where: { id: ids.debtor }, data: { ledgerBalance: 20_000, owedSince: new Date() } });
      expect((await http().post('/api/users/me/delete').set(as('debtor')).send({ password: 'blue-Tiger-42' }).expect(409)).body.error.code).toBe('BALANCE_OWED');
      await job('pro', 100_000, 'IN_PROGRESS', 'cust2');
      expect((await http().post('/api/users/me/delete').set(as('cust2')).send({ password: 'blue-Tiger-42' }).expect(409)).body.error.code).toBe('ACTIVE_JOB');
    });

    it('deletes: signed out at once, profile anonymised, open requests cancelled, money history kept', async () => {
      await user('leaver', 'customer');
      const phone = (await prisma.user.findUniqueOrThrow({ where: { id: ids.leaver } })).phone!;
      const open = await prisma.jobRequest.create({ data: { customerId: ids.leaver, customerName: 'l', description: 'x', status: 'MATCHES_FOUND' } });
      const paid = await job('pro', 100_000, 'COMPLETED', 'leaver');
      await prisma.payment.create({ data: { jobRequestId: paid, method: 'CASH', amount: 100_000, currency: 'PKR', status: 'CONFIRMED' } });

      await http().post('/api/users/me/delete').set(as('leaver')).send({ password: 'blue-Tiger-42' }).expect(200);
      await http().get('/api/auth/me').set(as('leaver')).expect(401);
      const u = await prisma.user.findUniqueOrThrow({ where: { id: ids.leaver } });
      expect(u).toMatchObject({ status: 'DELETED', name: 'Deleted user', phone: null, email: null });
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('CANCELLED');
      expect(await prisma.payment.count({ where: { jobRequestId: paid } })).toBe(1);
      // The number can be used for a new account.
      await http().post('/api/auth/signup').set('X-Forwarded-For', '10.77.0.1')
        .send({ name: 'New Person', phone, countryCode: 'PK', password: 'blue-Tiger-42', type: 'customer', deviceId: 'dev-new-0001', platform: 'android' }).expect(201);
      await prisma.user.deleteMany({ where: { phone } });
    });
  });
});
