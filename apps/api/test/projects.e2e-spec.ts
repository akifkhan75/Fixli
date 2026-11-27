import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { NotificationService } from '../src/notifications/notifications.service';
import { CARD_GATEWAY, StripeGateway } from '../src/payments/card.gateway';
import { ProjectsSweeper } from '../src/projects/projects.sweeper';
import { SMS_PROVIDER } from '../src/safety/sms.provider';

/** Larger work: post -> price -> hire -> stages -> money, in both payment modes. */
describe('Projects: bids, stages, escrow and direct payment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `proj${Date.now()}`;
  const suffix = String(Date.now()).slice(-6);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const phones: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let categoryId: string;
  let addressId: string;
  let n = 0;

  // The real Stripe gateway with a pretend network: signatures and request shapes are exercised.
  const secret = 'whsec_e2e';
  const stripeCalls: { path: string; form: Record<string, string>; key: string }[] = [];
  let sessions = 0;
  const fakeStripe: any = async (url: string, init: any) => {
    const path = url.replace('https://api.stripe.com/v1/', '');
    stripeCalls.push({ path, form: Object.fromEntries(new URLSearchParams(init.body)), key: init.headers['Idempotency-Key'] });
    const id = `cs_${tag}_${++sessions}`;
    return { ok: true, status: 200, json: async () => (path === 'refunds' ? { id: 're_1' } : { id, url: `https://pay.example/${id}` }) };
  };
  const texts: { to: string; text: string }[] = [];
  const sms = { name: 'fake', configured: true, send: async (to: string, text: string) => { texts.push({ to, text }); return { ok: true as const }; } };

  const webhook = (object: Record<string, unknown>, type = 'checkout.session.completed', sign = secret) => {
    const body = JSON.stringify({ type, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', sign).update(`${t}.${body}`).digest('hex');
    return http().post('/api/payments/stripe/webhook').set('Stripe-Signature', `t=${t},v1=${v1}`).set('Content-Type', 'application/json').send(body);
  };
  const paid = (stageId: string, amount: number, ref?: string) => async () => {
    const p = await prisma.projectPayment.findFirstOrThrow({ where: { milestoneId: stageId, ...(ref ? { providerRef: ref } : {}) }, orderBy: { createdAt: 'desc' } });
    return webhook({ id: p.providerRef, payment_status: 'paid', payment_intent: `pi_${p.id}`, amount_total: amount, currency: 'pkr' });
  };

  async function user(k: string, type: 'customer' | 'worker' | 'admin', opts: { roles?: string[]; lat?: number } = {}) {
    phones[k] = `+92303${suffix}${n++}`;
    const u = await prisma.user.create({
      data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone: type === 'admin' ? null : phones[k], password: await bcrypt.hash('blue-Tiger-42', 4), type, countryCode: 'PK', adminRoles: opts.roles ?? [] },
    });
    if (type === 'worker') {
      await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', currency: 'PKR', serviceLat: opts.lat ?? 24.92, serviceLng: 67.09, serviceRadius: 15 } });
      await prisma.workerService.create({ data: { workerId: u.id, categoryId } });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  const post = async (over: Record<string, unknown> = {}) => {
    const res = await http().post('/api/projects').set(as('cust')).send({
      categoryId, addressId, title: 'Wire the new house', description: 'Two floors, six rooms', workType: 'NEW_BUILD',
      budgetMin: 10_000_000, budgetMax: 30_000_000, idempotencyKey: `${tag}-${Math.random().toString(36).slice(2)}`, ...over,
    });
    if (res.status !== 201) throw new Error(`post ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const stages = [{ title: 'Pipes in walls', amount: 8_000_000 }, { title: 'Fittings', amount: 12_000_000 }];
  const bid = (projectId: string, who = 'spark', over: Record<string, unknown> = {}) =>
    http().put(`/api/projects/${projectId}/bids/mine`).set(as(who)).send({ totalAmount: 20_000_000, durationDays: 20, milestones: stages, ...over });
  const hire = async (paymentMode: 'DIRECT' | 'ESCROW') => {
    const p = await post();
    const b = await bid(p.id).expect(200);
    const res = await http().post(`/api/projects/${p.id}/award`).set(as('cust')).send({ bidId: b.body.id, paymentMode }).expect(200);
    return { id: p.id as string, stages: res.body.milestones as { id: string; amount: number }[] };
  };
  const balance = async (w = 'spark') => (await prisma.worker.findUniqueOrThrow({ where: { id: ids[w] } })).ledgerBalance;
  const resetBalance = async () => { await prisma.worker.updateMany({ where: { id: { in: [ids.spark, ids.volt] } }, data: { ledgerBalance: 0, owedSince: null, balanceBlocked: false } }); };
  const stage = (id: string) => prisma.projectMilestone.findUniqueOrThrow({ where: { id }, include: { payments: true } });
  const act = (id: string, action: string, who: string, body: object = {}) => http().post(`/api/project-stages/${id}/${action}`).set(as(who)).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CARD_GATEWAY).useValue(new StripeGateway({ secretKey: 'sk_test_e2e', webhookSecret: secret }, fakeStripe))
      .overrideProvider(SMS_PROVIDER).useValue(sms)
      .compile();
    app = mod.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    categoryId = (await prisma.serviceCategory.create({ data: { name: `E2E_${tag}` } })).id;
    await user('cust', 'customer');
    await user('stranger', 'customer');
    await user('spark', 'worker');
    await user('volt', 'worker');
    await user('far', 'worker', { lat: 31.5 }); // another city
    await user('finance', 'admin', { roles: ['Super Admin'] });
    addressId = (await prisma.address.create({ data: { userId: ids.cust, streetAddress: 'House 12, Street 4', area: 'Gulshan', city: 'Karachi', country: 'PK', latitude: 24.92, longitude: 67.09 } })).id;
  }, 60_000);

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { workerId: { in: userIds } } }).catch(() => undefined);
    await prisma.review.deleteMany({ where: { reviewerId: { in: userIds } } });
    await prisma.dispute.deleteMany({ where: { raisedById: { in: userIds } } });
    await prisma.message.deleteMany({ where: { senderId: { in: userIds } } });
    await prisma.conversation.deleteMany({ where: { project: { customerId: { in: userIds } } } });
    await prisma.project.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.phoneVerification.deleteMany({ where: { phone: { in: Object.values(phones) } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workerService.deleteMany({ where: { workerId: { in: userIds } } });
    // The ledger is append-only, so workers with entries stay (as in production).
    await prisma.serviceCategory.update({ where: { id: categoryId }, data: { isActive: false } }).catch(() => undefined);
    await app.close();
  });

  describe('posting and pricing', () => {
    let projectId: string;

    it('invites nearby professionals with the skill, once even if the send repeats', async () => {
      const key = `${tag}-same-key-1`;
      const a = await post({ idempotencyKey: key });
      const b = await post({ idempotencyKey: key });
      expect(b.id).toBe(a.id);
      projectId = a.id;
      const invited = (await prisma.projectInvite.findMany({ where: { projectId } })).map((i) => i.workerId).sort();
      expect(invited).toEqual([ids.spark, ids.volt].sort());
      await app.get(NotificationService).idle();
      expect(await prisma.notification.count({ where: { userId: ids.spark, type: 'project.new' } })).toBeGreaterThan(0);
    });

    it('an invited professional sees the area but never the address or full name', async () => {
      const res = await http().get(`/api/projects/${projectId}`).set(as('spark')).expect(200);
      expect(res.body).toMatchObject({ viewer: 'candidate', area: 'Gulshan', location: null, latitude: null, customer: { name: 'cust' } });
      expect(JSON.stringify(res.body)).not.toContain('House 12');
      const feed = await http().get('/api/workers/me/projects').set(as('spark')).expect(200);
      expect(feed.body.map((p: any) => p.id)).toContain(projectId);
      expect(JSON.stringify(feed.body)).not.toContain('House 12');
    });

    it('keeps outsiders out', async () => {
      await http().get(`/api/projects/${projectId}`).set(as('far')).expect(404);
      await http().get(`/api/projects/${projectId}`).set(as('stranger')).expect(404);
      await http().get(`/api/projects/${projectId}/bids`).set(as('stranger')).expect(404);
      await bid(projectId, 'far').expect(404);
      await http().post('/api/projects').set(as('spark')).send({}).expect(403);
    });

    it('refuses stages that do not add up, and lets a price be revised', async () => {
      const wrong = await bid(projectId, 'spark', { totalAmount: 21_000_000 }).expect(400);
      expect(wrong.body.error.code).toBe('STAGES_DONT_ADD_UP');
      await bid(projectId).expect(200);
      await bid(projectId, 'spark', { totalAmount: 20_000_000, note: 'Copper wire included' }).expect(200);
      await bid(projectId, 'volt', { totalAmount: 18_000_000, milestones: undefined }).expect(200);
      const bids = await http().get(`/api/projects/${projectId}/bids`).set(as('cust')).expect(200);
      expect(bids.body).toHaveLength(2);
      expect(bids.body.find((b: any) => b.worker.id === ids.volt).milestones).toEqual([{ title: 'Wire the new house', amount: 18_000_000 }]);
    });

    it('a project with prices can no longer be rewritten', async () => {
      const res = await http().patch(`/api/projects/${projectId}`).set(as('cust')).send({ title: 'Something else' }).expect(409);
      expect(res.body.error.code).toBe('PROJECT_LOCKED');
    });

    it('two simultaneous hires pick exactly one professional', async () => {
      const bids = (await http().get(`/api/projects/${projectId}/bids`).set(as('cust'))).body;
      const results = await Promise.all(bids.map((b: any) => http().post(`/api/projects/${projectId}/award`).set(as('cust')).send({ bidId: b.id, paymentMode: 'DIRECT' })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { bids: true, milestones: true, conversations: true } });
      expect(p.bids.filter((b) => b.status === 'ACCEPTED')).toHaveLength(1);
      expect(p.conversations).toHaveLength(1);
      expect(p.milestones.reduce((s, m) => s + m.amount, 0)).toBe(p.agreedAmount);
      const winner = p.awardedWorkerId === ids.spark ? 'spark' : 'volt';
      const loser = winner === 'spark' ? 'volt' : 'spark';
      const outside = await http().get(`/api/projects/${projectId}`).set(as(loser)).expect(200);
      expect(outside.body).toMatchObject({ viewer: 'candidate', agreedAmount: null, location: null, milestones: [] });
      expect(outside.body.awardedWorkerId).toBeUndefined();
      expect(outside.body.customerId).toBeUndefined();
      const view = await http().get(`/api/projects/${projectId}`).set(as(winner)).expect(200);
      expect(view.body).toMatchObject({ viewer: 'hired' });
      expect(view.body.location).toContain('House 12');
      await http().get(`/api/conversations/by-project/${projectId}`).set(as(winner)).expect(200);
      await http().get(`/api/conversations/by-project/${projectId}`).set(as('stranger')).expect(404);
    });
  });

  describe('direct payment', () => {
    let p: Awaited<ReturnType<typeof hire>>;
    beforeAll(async () => { await resetBalance(); p = await hire('DIRECT'); });

    it('stages go in order and only the right side can move them', async () => {
      await act(p.stages[1].id, 'start', 'spark').expect(409);
      await act(p.stages[0].id, 'start', 'volt').expect(404);
      await act(p.stages[0].id, 'start', 'cust').expect(403);
      await act(p.stages[0].id, 'fund', 'cust').expect(409);
      await act(p.stages[0].id, 'start', 'spark').expect(200);
      await act(p.stages[0].id, 'approve', 'cust').expect(400);
      expect((await act(p.stages[0].id, 'submit', 'spark').expect(409)).body.error.code).toBe('SHOW_THE_WORK');
      await act(p.stages[0].id, 'submit', 'spark', { note: 'Done' }).expect(200);
      await act(p.stages[0].id, 'mark-paid', 'spark').expect(400);
    });

    it('changes can be requested, then approval waits for the payment to be confirmed', async () => {
      await act(p.stages[0].id, 'request-changes', 'cust', { note: 'One socket missing' }).expect(200);
      expect((await stage(p.stages[0].id)).changesNote).toBe('One socket missing');
      await act(p.stages[0].id, 'submit', 'spark', { note: 'Added it' }).expect(200);
      expect((await act(p.stages[0].id, 'approve', 'cust').expect(200)).body.status).toBe('APPROVED');
      expect(await balance()).toBe(0);
      await act(p.stages[1].id, 'start', 'spark').expect(409);
    });

    it('five simultaneous "I was paid" taps book the fee exactly once', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => act(p.stages[0].id, 'mark-paid', 'spark')));
      expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
      const fees = await prisma.ledgerEntry.findMany({ where: { idempotencyKey: `commission:stage:${p.stages[0].id}` } });
      expect(fees).toHaveLength(1);
      expect(await balance()).toBe(fees[0].amount);
      expect((await stage(p.stages[0].id)).payments).toHaveLength(1);
    });

    it('silence approves and then closes the last stage; both can review the finished project', async () => {
      await prisma.worker.update({ where: { id: ids.spark }, data: { ledgerBalance: 0, balanceBlocked: false, owedSince: null } });
      await act(p.stages[1].id, 'start', 'spark').expect(200);
      await act(p.stages[1].id, 'submit', 'spark', { note: 'All fitted' }).expect(200);
      await prisma.projectMilestone.update({ where: { id: p.stages[1].id }, data: { submittedAt: new Date(Date.now() - 8 * 86_400_000) } });
      await app.get(ProjectsSweeper).sweep();
      expect((await stage(p.stages[1].id)).status).toBe('APPROVED');
      await prisma.projectMilestone.update({ where: { id: p.stages[1].id }, data: { approvedAt: new Date(Date.now() - 8 * 86_400_000) } });
      await app.get(ProjectsSweeper).sweep();
      expect((await stage(p.stages[1].id)).status).toBe('RELEASED');
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('COMPLETED');
      await http().post('/api/reviews').set(as('cust')).send({ projectId: p.id, rating: 5 }).expect(201);
      await http().post('/api/reviews').set(as('spark')).send({ projectId: p.id, rating: 5 }).expect(201);
      await http().post('/api/reviews').set(as('cust')).send({ projectId: p.id, rating: 4 }).expect(409);
      await http().post('/api/reviews').set(as('stranger')).send({ projectId: p.id, rating: 1 }).expect(404);
      const earnings = await http().get('/api/workers/me/earnings').set(as('spark')).expect(200);
      expect(earnings.body.gross).toBeGreaterThanOrEqual(20_000_000);
    });
  });

  describe('card escrow', () => {
    let p: Awaited<ReturnType<typeof hire>>;
    beforeAll(async () => { await resetBalance(); p = await hire('ESCROW'); });

    it('work cannot start until the money is held', async () => {
      await act(p.stages[0].id, 'start', 'spark').expect(400);
    });

    it('opens one payment page, reused on a second tap, and hides it from the professional', async () => {
      const a = await act(p.stages[0].id, 'fund', 'cust').expect(200);
      const b = await act(p.stages[0].id, 'fund', 'cust').expect(200);
      expect(b.body.checkoutUrl).toBe(a.body.checkoutUrl);
      expect(stripeCalls.at(-1)).toMatchObject({ path: 'checkout/sessions', form: { 'line_items[0][price_data][unit_amount]': '8000000' } });
      const w = await http().get(`/api/projects/${p.id}`).set(as('spark')).expect(200);
      expect(w.body.milestones[0].payments[0].checkoutUrl).toBeNull();
      await act(p.stages[0].id, 'fund', 'spark').expect(403);
      await act(p.stages[1].id, 'fund', 'cust').expect(409);
    });

    it('ignores forged and unsigned webhooks', async () => {
      const row = await prisma.projectPayment.findFirstOrThrow({ where: { milestoneId: p.stages[0].id } });
      const body = { id: row.providerRef, payment_status: 'paid', payment_intent: 'pi_x', amount_total: row.amount, currency: 'pkr' };
      await webhook(body, 'checkout.session.completed', 'whsec_wrong').expect(400);
      await http().post('/api/payments/stripe/webhook').send(body).expect(400);
      expect((await stage(p.stages[0].id)).status).toBe('PENDING');
    });

    it('a genuine payment holds the money once, even delivered twice', async () => {
      await (await paid(p.stages[0].id, 8_000_000)()).body;
      await (await paid(p.stages[0].id, 8_000_000)()).body;
      const s = await stage(p.stages[0].id);
      expect(s.status).toBe('FUNDED');
      expect(s.payments).toHaveLength(1);
      expect(s.payments[0].status).toBe('HELD');
    });

    it('approval credits the professional the amount minus the fee, exactly once', async () => {
      await act(p.stages[0].id, 'start', 'spark').expect(200);
      await act(p.stages[0].id, 'mark-paid', 'spark').expect(403);
      await act(p.stages[0].id, 'submit', 'spark', { note: 'Done' }).expect(200);
      const results = await Promise.all(Array.from({ length: 4 }, () => act(p.stages[0].id, 'approve', 'cust')));
      expect(results.some((r) => r.status === 200)).toBe(true);
      const entries = await prisma.ledgerEntry.findMany({ where: { workerId: ids.spark, idempotencyKey: { in: [`escrow:${p.stages[0].id}`, `commission:stage:${p.stages[0].id}`] } } });
      expect(entries).toHaveLength(2);
      const credit = entries.find((e) => e.type === 'ESCROW_CREDIT')!.amount;
      const fee = entries.find((e) => e.type === 'COMMISSION_OWED')!.amount;
      expect(credit).toBe(-8_000_000);
      expect(fee).toBeGreaterThan(0);
      expect(await balance()).toBe(credit + fee); // negative: Fixli owes the professional
      expect((await stage(p.stages[0].id)).payments[0]).toMatchObject({ status: 'RELEASED', commission: fee });
    });

    it('the wrong amount never funds a stage: it is refunded', async () => {
      await act(p.stages[1].id, 'fund', 'cust').expect(200);
      const before = stripeCalls.filter((c) => c.path === 'refunds').length;
      await (await paid(p.stages[1].id, 1)()).body;
      expect((await stage(p.stages[1].id)).status).toBe('PENDING');
      expect(stripeCalls.filter((c) => c.path === 'refunds')).toHaveLength(before + 1);
      expect((await stage(p.stages[1].id)).payments[0].status).toBe('REFUNDED');
    });

    it('a dispute is settled by staff: refund returns the money and keeps nothing', async () => {
      await prisma.projectPayment.updateMany({ where: { milestoneId: p.stages[1].id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      await act(p.stages[1].id, 'fund', 'cust').expect(200);
      await (await paid(p.stages[1].id, 12_000_000)()).body;
      const d = await act(p.stages[1].id, 'dispute', 'cust', { reason: 'They stopped coming' }).expect(200);
      const cancel = await http().post(`/api/projects/${p.id}/cancel`).set(as('cust')).send({}).expect(409);
      expect(cancel.body.error.code).toBe('STAGE_IN_PROGRESS');
      const detail = await http().get(`/api/admin/v1/disputes/${d.body.disputeId}`).set(as('finance')).expect(200);
      expect(detail.body.project).toMatchObject({ paymentMode: 'ESCROW', stage: { status: 'DISPUTED' } });
      await http().get('/api/disputes/all').set(as('finance')).expect(200);
      const noOutcome = await http().patch(`/api/disputes/${d.body.disputeId}/resolve`).set(as('finance')).send({ status: 'RESOLVED', resolution: 'x' }).expect(400);
      expect(noOutcome.body.error.code).toBe('STAGE_OUTCOME_REQUIRED');
      const owedBefore = await balance();
      await http().patch(`/api/disputes/${d.body.disputeId}/resolve`).set(as('finance')).send({ status: 'RESOLVED', resolution: 'Refunded', stageOutcome: 'REFUND' }).expect(200);
      const s = await stage(p.stages[1].id);
      expect(s.status).toBe('CANCELLED');
      expect(s.payments.map((x) => x.status)).toEqual(['REFUNDED', 'REFUNDED']);
      expect(await balance()).toBe(owedBefore);
      // One stage was paid, the other cancelled: the project is complete.
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('COMPLETED');
    });

    it('cancelling before work starts refunds held money', async () => {
      await resetBalance();
      const q = await hire('ESCROW');
      await act(q.stages[0].id, 'fund', 'cust').expect(200);
      await (await paid(q.stages[0].id, 8_000_000)()).body;
      await http().post(`/api/projects/${q.id}/cancel`).set(as('cust')).send({ reason: 'Plans changed' }).expect(200);
      await app.get(ProjectsSweeper).sweep();
      expect((await stage(q.stages[0].id)).payments[0].status).toBe('REFUNDED');
      await act(q.stages[0].id, 'start', 'spark').expect(409);
    });
  });

  describe('materials and visits', () => {
    it('both sides keep one list and plan several visits', async () => {
      await resetBalance();
      const p = await hire('DIRECT');
      const m = await http().post(`/api/projects/${p.id}/materials`).set(as('spark')).send({ name: '2.5mm wire', quantity: 3, unit: 'coils', providedBy: 'customer' }).expect(201);
      await http().patch(`/api/projects/${p.id}/materials/${m.body.id}`).set(as('cust')).send({ isReady: true }).expect(200);
      await http().delete(`/api/projects/${p.id}/materials/${m.body.id}`).set(as('cust')).expect(404); // only who added it
      await http().post(`/api/projects/${p.id}/visits`).set(as('cust')).send({ scheduledAt: new Date(Date.now() - 86_400_000).toISOString() }).expect(400);
      const v = await http().post(`/api/projects/${p.id}/visits`).set(as('cust')).send({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
      await http().post(`/api/projects/${p.id}/visits`).set(as('spark')).send({ scheduledAt: new Date(Date.now() + 172_800_000).toISOString() }).expect(201);
      await http().patch(`/api/projects/${p.id}/visits/${v.body.id}`).set(as('spark')).send({ status: 'DONE' }).expect(200);
      await http().post(`/api/projects/${p.id}/materials`).set(as('volt')).send({ name: 'x', quantity: 1, providedBy: 'worker' }).expect(404);
    });
  });

  describe('sign in with a texted code', () => {
    const device = { deviceId: 'e2e-code-login-1' };
    it('signs a registered person in, once per code', async () => {
      await http().post('/api/auth/login/code/start').send({ phone: phones.cust, countryCode: 'PK' }).expect(200);
      const code = texts.at(-1)!.text.match(/\d{6}/)![0];
      const bad = code === '000000' ? '111111' : '000000';
      await http().post('/api/auth/login/code').send({ phone: phones.cust, countryCode: 'PK', code: bad, ...device }).expect(400);
      const ok = await http().post('/api/auth/login/code').send({ phone: phones.cust, countryCode: 'PK', code, ...device }).expect(200);
      expect(ok.body.user.id).toBe(ids.cust);
      expect(ok.body.token).toBeDefined();
      expect(JSON.stringify(ok.body)).not.toContain('password');
      await http().post('/api/auth/login/code').send({ phone: phones.cust, countryCode: 'PK', code, ...device }).expect(400);
    });

    it('answers the same for an unknown number but sends nothing', async () => {
      const sent = texts.length;
      const res = await http().post('/api/auth/login/code/start').send({ phone: '+923039999999', countryCode: 'PK' }).expect(200);
      expect(res.body).toHaveProperty('resendInSeconds');
      expect(texts).toHaveLength(sent);
      await prisma.phoneVerification.deleteMany({ where: { phone: '+923039999999' } });
    });
  });
});
