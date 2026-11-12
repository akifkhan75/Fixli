import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { COUNTRIES } from '@fixli/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';
import { computeCommission } from '../src/common/commission';

/** Cash -> commission ledger against a real database (doc 27 R2 exit criteria). */
describe('Payments & ledger (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let payments: PaymentsService;
  const tag = `pay${Date.now()}`;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const cfg = COUNTRIES.PK.commission;
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function makeUser(key: string, type: 'customer' | 'worker') {
    const user = await prisma.user.create({
      data: { name: `${key} user`, email: `${tag}-${key}@test.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK' },
    });
    if (type === 'worker') await prisma.worker.create({ data: { id: user.id, activationStatus: 'ACTIVE', isVerified: true, isOnline: true } });
    const session = await prisma.session.create({ data: { userId: user.id, deviceId: `d-${key}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3_600_000) } });
    ids[key] = user.id;
    tokens[key] = jwt.sign({ sub: user.id, type, sid: session.id });
  }

  const finishedJob = (customer: string, worker: string, agreedAmount: number) =>
    prisma.jobRequest.create({
      data: { customerId: ids[customer], customerName: customer, description: 'x', title: 'Tap', status: 'AWAITING_CONFIRMATION', assignedWorkerId: ids[worker], agreedAmount, agreedCurrency: 'PKR', currency: 'PKR' },
    });

  const ledgerOf = (worker: string) => prisma.ledgerEntry.findMany({ where: { workerId: ids[worker] }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    payments = app.get(PaymentsService);
    for (const k of ['custA', 'custB']) await makeUser(k, 'customer');
    for (const k of ['w1', 'w2', 'w3']) await makeUser(k, 'worker');
  }, 60_000);

  afterAll(async () => { await app.close(); });

  it('validates input with DTOs: no negatives, no client currency, workers only', async () => {
    const job = await finishedJob('custA', 'w1', 100_000);
    await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: -5 }).expect(400);
    await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: 1.5 }).expect(400);
    await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: 100_000, currency: 'USD' }).expect(400);
    await http().post(`/api/payments/job/${job.id}/cash`).set(as('custA')).send({ amount: 100_000 }).expect(403);
    await http().post(`/api/payments/job/${job.id}/cash`).set(as('w2')).send({ amount: 100_000 }).expect(404); // not their job: existence is not revealed
    expect(await prisma.payment.count({ where: { jobRequestId: job.id } })).toBe(0);
  });

  it('records in the JOB currency; a repeat is idempotent; a different amount conflicts', async () => {
    const job = await finishedJob('custA', 'w1', 100_000);
    const a = await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: 100_000 }).expect(201);
    expect(a.body.currency).toBe('PKR');
    const b = await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: 100_000 }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: 90_000 }).expect(409);
    expect(await prisma.payment.count({ where: { jobRequestId: job.id } })).toBe(1);
  });

  it('only the job\'s customer can confirm; confirming twice makes ONE ledger entry', async () => {
    const job = await finishedJob('custA', 'w1', 100_000);
    const { body: p } = await http().post(`/api/payments/job/${job.id}/cash`).set(as('w1')).send({ amount: 100_000 }).expect(201);
    await http().post(`/api/payments/${p.id}/confirm`).set(as('custB')).expect(403);
    const before = (await ledgerOf('w1')).length;
    await http().post(`/api/payments/${p.id}/confirm`).set(as('custA')).expect(201);
    await http().post(`/api/payments/${p.id}/confirm`).set(as('custA')).expect(201);
    const after = await ledgerOf('w1');
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ amount: -computeCommission(100_000, cfg), currency: 'PKR', idempotencyKey: `commission:${p.id}` });
  });

  it('concurrency: 10 simultaneous marks -> 1 payment; 10 simultaneous confirms -> 1 entry', async () => {
    const job = await finishedJob('custA', 'w2', 100_000);
    const marks = await Promise.allSettled(Array.from({ length: 10 }, () => payments.markCashReceived(job.id, ids.w2, { amount: 100_000 })));
    expect(marks.every((m) => m.status === 'fulfilled')).toBe(true);
    expect(await prisma.payment.count({ where: { jobRequestId: job.id } })).toBe(1);
    const p = (await prisma.payment.findFirst({ where: { jobRequestId: job.id } }))!;
    await Promise.allSettled(Array.from({ length: 10 }, () => payments.confirmPayment(p.id, ids.custA)));
    expect(await prisma.ledgerEntry.count({ where: { workerId: ids.w2, jobRequestId: job.id } })).toBe(1);
  });

  it('disputes: commission only on the undisputed minimum; a Dispute row is opened; repeat is a no-op', async () => {
    const job = await finishedJob('custA', 'w3', 150_000);
    const { body: p } = await http().post(`/api/payments/job/${job.id}/cash`).set(as('w3')).send({ amount: 150_000 }).expect(201);
    await http().post(`/api/payments/${p.id}/dispute`).set(as('custA')).send({ claimedAmount: 150_000 }).expect(400);
    await http().post(`/api/payments/${p.id}/dispute`).set(as('custA')).send({ claimedAmount: 100_000 }).expect(201);
    await http().post(`/api/payments/${p.id}/dispute`).set(as('custA')).send({ claimedAmount: 100_000 }).expect(201);
    const entries = await prisma.ledgerEntry.findMany({ where: { jobRequestId: job.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(-computeCommission(100_000, cfg));
    const disputes = await prisma.dispute.findMany({ where: { jobRequestId: job.id } });
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ amountHeld: 50_000, category: 'PAYMENT_AMOUNT' });
    await http().post(`/api/payments/${p.id}/confirm`).set(as('custA')).expect(400); // no longer confirmable
  });

  it('the ledger is append-only (database trigger)', async () => {
    const e = (await ledgerOf('w1'))[0];
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { amount: 0 } })).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
  });

  it('only one live payment per job at the database level', async () => {
    const job = await finishedJob('custA', 'w1', 100_000);
    await prisma.payment.create({ data: { jobRequestId: job.id, method: 'CASH', amount: 1, currency: 'PKR', status: 'MARKED_BY_WORKER' } });
    await expect(prisma.payment.create({ data: { jobRequestId: job.id, method: 'CASH', amount: 1, currency: 'PKR', status: 'CONFIRMED' } })).rejects.toThrow();
  });

  it('reconciles over 50 scripted jobs (confirmed, disputed, auto-confirmed): ledger == payments', async () => {
    await makeUser('wR', 'worker');
    let expected = 0;
    let paymentsWithEntries = 0;
    for (let i = 0; i < 50; i++) {
      const amount = 20_000 + i * 37_001; // spans below-min, normal and above-max commission
      const job = await finishedJob('custA', 'wR', amount);
      const p = await payments.markCashReceived(job.id, ids.wR, { amount });
      if (i % 5 === 3) {
        const claimed = Math.floor(amount / 2);
        await payments.disputePayment(p.id, ids.custA, claimed);
        expected += computeCommission(claimed, cfg);
      } else if (i % 5 === 4) {
        await prisma.payment.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
        await payments.sweepCash();
        expected += computeCommission(amount, cfg);
      } else {
        await payments.confirmPayment(p.id, ids.custA);
        expected += computeCommission(amount, cfg);
      }
      paymentsWithEntries++;
    }
    const entries = await ledgerOf('wR');
    expect(entries).toHaveLength(paymentsWithEntries);
    const sum = entries.reduce((a, e) => a + e.amount, 0);
    expect(sum).toBe(-expected);
    // The lowest running balance is the final one (every entry only adds debt) and equals the sum.
    expect(Math.min(...entries.map((e) => e.balanceAfter))).toBe(-expected);
    expect(await prisma.payment.count({ where: { jobRequest: { assignedWorkerId: ids.wR }, autoConfirmed: true } })).toBe(10);
  }, 120_000);

  it('hard cap: owing more than the limit forces offline and blocks going online; earnings show the status', async () => {
    const w = (await prisma.worker.findUnique({ where: { id: ids.wR } }))!;
    expect(w.isOnline).toBe(false); // the 50-job run pushed this worker past PKR 5,000
    const res = await http().patch('/api/workers/me').set(as('wR')).send({ isOnline: true }).expect(403);
    expect(res.body.code ?? res.body.message?.code ?? JSON.stringify(res.body)).toContain('COMMISSION_CAP_EXCEEDED');
    const earnings = await http().get('/api/workers/me/earnings').set(as('wR')).expect(200);
    expect(earnings.body).toMatchObject({ status: 'BLOCKED', currency: 'PKR', hardLimit: cfg.hardLimitMinor });
    expect(earnings.body.owed).toBeGreaterThan(cfg.hardLimitMinor);
    expect(earnings.body.balance).toBe(-earnings.body.owed);
    expect(earnings.body.history.length).toBeGreaterThan(0);
    expect(earnings.body.history[0]).toEqual(expect.objectContaining({ id: expect.any(String), type: 'COMMISSION_OWED', amount: expect.any(Number) }));
    // A worker under the limit can still go online.
    await http().patch('/api/workers/me').set(as('w1')).send({ isOnline: true }).expect(200);
  });
});
