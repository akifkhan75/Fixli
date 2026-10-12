import { Test } from '@nestjs/testing';
import { CallHandler, ExecutionContext, INestApplication, NestInterceptor, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { from, mergeMap, switchMap } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { NotificationService } from '../src/notifications/notifications.service';
import { seedCatalog } from '../prisma/seed-catalog';
import { PERMISSION_KEY } from '../src/common/auth/permissions';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

const HOME = { lat: 24.92, lng: 67.09 };

/** Watches every successful staff change in this suite: did it add an audit row? */
const auditedHandlers = new Set<string>();
const unauditedHandlers = new Set<string>();
class AuditWatch implements NestInterceptor {
  constructor(private readonly count: () => Promise<number>) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.getType() === 'http' ? ctx.switchToHttp().getRequest() : null;
    if (!req || req.method === 'GET' || req.user?.type !== 'admin') return next.handle();
    const key = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    return from(this.count()).pipe(switchMap((before) => next.handle().pipe(mergeMap(async (out) => {
      ((await this.count()) > before ? auditedHandlers : unauditedHandlers).add(key);
      return out;
    }))));
  }
}

/** doc 27 F6: the staff portal on real data, every change audited, each role limited. */
describe('Admin console (doc 27 F6, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `adm${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let plumbing: string;
  let n = 0;

  async function user(k: string, type: 'customer' | 'worker' | 'admin', roles: string[] = [], at?: { lat: number; lng: number }) {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone: type === 'admin' ? null : `+92304${String(Date.now()).slice(-6)}${n++}`.slice(0, 13), password: await bcrypt.hash('blue-Tiger-42', 4), type, countryCode: 'PK', adminRoles: roles } });
    if (type === 'worker') await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true, serviceRadius: 10, serviceLat: at?.lat, serviceLng: at?.lng, services: { create: [{ categoryId: plumbing }] }, workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) } } as any });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }
  const audited = (action: string, entityId?: string) => prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });
  const types = async (k: string) => { await app.get(NotificationService).idle(); return (await prisma.notification.findMany({ where: { userId: ids[k] } })).map((x) => x.type); };
  const booked = (status = 'ACCEPTED', worker = 'pro') => prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', title: 'Leaking tap', description: 'x', status: status as any, assignedWorkerId: ids[worker], categoryId: plumbing, latitude: HOME.lat, longitude: HOME.lng, agreedAmount: 150_000, agreedCurrency: 'PKR', bookedAt: new Date() } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalInterceptors(new AuditWatch(() => app.get(PrismaService).auditLog.count()));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await seedCatalog(prisma as any);
    plumbing = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    await user('cust', 'customer');
    await user('pro', 'worker', [], { lat: 24.928, lng: 67.095 });
    await user('pro2', 'worker', [], { lat: 24.93, lng: 67.093 });
    for (const [k, r] of [['super', 'Super Admin'], ['ops', 'Operations'], ['support', 'Support'], ['finance', 'Finance'], ['safety', 'Safety'], ['content', 'Content'], ['analyst', 'Analytics'], ['auditor', 'Auditor']] as const) await user(k, 'admin', [r]);
  }, 60_000);

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.incident.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.review.deleteMany({ where: { reviewerId: { in: userIds } } });
    await prisma.conversation.deleteMany({ where: { jobRequest: { customerId: { in: userIds } } } });
    await prisma.payment.deleteMany({ where: { jobRequest: { customerId: { in: userIds } } } });
    await prisma.ledgerEntry.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.settlement.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.serviceCategory.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { email: { startsWith: tag } }] } });
    await app.close();
  });

  it('the menu follows the roles: "me" lists only what each role may do', async () => {
    const a = await http().get('/api/admin/v1/me').set(as('analyst')).expect(200);
    expect(a.body.permissions).toEqual(expect.arrayContaining(['dashboard.view', 'jobs.read']));
    expect(a.body.permissions).not.toContain('pii.view');
    expect((await http().get('/api/admin/v1/me').set(as('super')).expect(200)).body.permissions).toContain('config.edit');
  });

  it('the dashboard counts real data', async () => {
    const before = (await http().get('/api/admin/v1/dashboard').set(as('analyst')).expect(200)).body;
    const j = await booked('COMPLETED');
    await prisma.payment.create({ data: { jobRequestId: j.id, method: 'CASH', amount: 150_000, currency: 'PKR', status: 'CONFIRMED', confirmedAt: new Date() } });
    const after = (await http().get('/api/admin/v1/dashboard').set(as('analyst')).expect(200)).body;
    expect(after.requests).toBe(before.requests + 1);
    expect(after.booked).toBe(before.booked + 1);
    const pkr = (b: any) => b.gmv.find((g: any) => g.currency === 'PKR')?.amount ?? 0;
    expect(pkr(after) - pkr(before)).toBe(150_000);
    expect(after).toHaveProperty('fillRate');
    expect(after).toHaveProperty('commissionOwed');
  });

  it('job detail for job staff; the chat transcript needs chat.read and is audited', async () => {
    const j = await booked();
    await prisma.conversation.create({ data: { jobRequestId: j.id, participants: { connect: [{ id: ids.cust }, { id: ids.pro }] }, messages: { create: [{ senderId: ids.cust, text: 'Hi' }] } } });
    const d = await http().get(`/api/admin/v1/jobs/${j.id}`).set(as('analyst')).expect(200);
    expect(d.body).toMatchObject({ id: j.id, status: 'ACCEPTED' });
    expect(d.body.conversationId).toBeTruthy();
    await http().get(`/api/admin/v1/jobs/${j.id}/transcript`).set(as('analyst')).expect(403);
    const t = await http().get(`/api/admin/v1/jobs/${j.id}/transcript`).set(as('support')).expect(200);
    expect(t.body.messages[0]).toMatchObject({ text: 'Hi' });
    expect(await audited('chat.transcript_viewed', j.id)).toBe(1);
  });

  it('cancel goes through the job rules: event, both sides told, finished jobs refused', async () => {
    const j = await booked();
    await http().post(`/api/admin/v1/jobs/${j.id}/cancel`).set(as('support')).send({ reason: 'Customer asked by phone' }).expect(201);
    const after = await prisma.jobRequest.findUniqueOrThrow({ where: { id: j.id }, include: { events: true } });
    expect(after.status).toBe('CANCELLED');
    expect(after.events.at(-1)).toMatchObject({ type: 'CANCELLED', actorId: ids.support });
    expect(await types('pro')).toContain('job.cancelled');
    const done = await booked('COMPLETED');
    await http().post(`/api/admin/v1/jobs/${done.id}/cancel`).set(as('support')).send({ reason: 'mistake' }).expect(400);
    await http().post(`/api/admin/v1/jobs/${done.id}/cancel`).set(as('analyst')).send({ reason: 'mistake' }).expect(403);
  });

  it('reassign: back to open, the worker and customer told, matching runs again without the old worker', async () => {
    const j = await booked('EN_ROUTE');
    await http().post(`/api/admin/v1/jobs/${j.id}/reassign`).set(as('analyst')).send({ reason: 'no show' }).expect(403);
    await http().post(`/api/admin/v1/jobs/${j.id}/reassign`).set(as('support')).send({ reason: 'Worker not answering' }).expect(200);
    const after = await prisma.jobRequest.findUniqueOrThrow({ where: { id: j.id } });
    expect(after).toMatchObject({ status: 'MATCHES_FOUND', assignedWorkerId: null, agreedAmount: null });
    expect(await types('cust')).toContain('job.reassigned');
    expect(await prisma.jobMatch.count({ where: { jobRequestId: j.id, workerId: ids.pro2 } })).toBe(1);
    expect(await audited('job.reassigned', j.id)).toBe(1);
    const working = await booked('IN_PROGRESS');
    await http().post(`/api/admin/v1/jobs/${working.id}/reassign`).set(as('support')).send({ reason: 'x x x' }).expect(400);
  });

  it('suspend and reactivate are audited', async () => {
    await http().post(`/api/admin/v1/users/${ids.pro2}/suspend`).set(as('safety')).send({ reason: 'Investigating a report' }).expect(201);
    await http().post(`/api/admin/v1/users/${ids.pro2}/reactivate`).set(as('safety')).send({ reason: 'Cleared' }).expect(200);
    await http().post(`/api/admin/v1/users/${ids.pro2}/reactivate`).set(as('safety')).send({ reason: 'Again' }).expect(409);
    expect(await audited('user.reactivated', ids.pro2)).toBe(1);
  });

  it('a Super Admin creates staff with a one-time password; nobody else can', async () => {
    await http().post('/api/admin/v1/staff').set(as('ops')).send({ email: `${tag}-new@t.com`, name: 'New Staff', roles: ['Support'] }).expect(403);
    const r = await http().post('/api/admin/v1/staff').set(as('super')).send({ email: `${tag}-new@t.com`, name: 'New Staff', roles: ['Support'] }).expect(201);
    expect(r.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await http().post('/api/auth/admin/login').send({ email: `${tag}-new@t.com`, password: r.body.temporaryPassword, deviceId: 'admin-web-0001' }).expect(200);
    await http().post('/api/admin/v1/staff').set(as('super')).send({ email: `${tag}-new@t.com`, name: 'Dup', roles: ['Support'] }).expect(409);
  });

  it('safety console: list, detail, notes and status; read-only roles can\'t change it', async () => {
    const i = await prisma.incident.create({ data: { reporterId: ids.cust, targetId: ids.pro, type: 'REPORT_USER', severity: 'MODERATE', description: 'SCAM: asked for a deposit' } });
    const list = await http().get('/api/admin/v1/safety/incidents?type=REPORT_USER').set(as('safety')).expect(200);
    expect(list.body.items.map((x: any) => x.id)).toContain(i.id);
    await http().get('/api/admin/v1/safety/incidents').set(as('finance')).expect(403);
    await http().patch(`/api/admin/v1/safety/incidents/${i.id}`).set(as('safety')).send({}).expect(400);
    const u = await http().patch(`/api/admin/v1/safety/incidents/${i.id}`).set(as('safety')).send({ status: 'INVESTIGATING', note: 'Called the customer' }).expect(200);
    expect(u.body).toMatchObject({ status: 'INVESTIGATING', target: { id: ids.pro } });
    expect(u.body.notes[0]).toMatchObject({ text: 'Called the customer', authorId: ids.safety });
    expect(await audited('incident.updated', i.id)).toBe(1);
  });

  it('finance: balances, a ledger correction booked once (double click), payments list', async () => {
    const body = { amount: 25_000, note: 'Missed commission on a phone booking', idempotencyKey: `${tag}-adj-1` };
    await http().post(`/api/admin/v1/finance/workers/${ids.pro}/adjustments`).set(as('support')).send(body).expect(403);
    await http().post(`/api/admin/v1/finance/workers/${ids.pro}/adjustments`).set(as('finance')).send(body).expect(201);
    await http().post(`/api/admin/v1/finance/workers/${ids.pro}/adjustments`).set(as('finance')).send(body).expect(201);
    expect((await prisma.worker.findUniqueOrThrow({ where: { id: ids.pro } })).ledgerBalance).toBe(25_000);
    expect(await audited('ledger.adjusted', ids.pro)).toBe(1);
    const b = await http().get('/api/admin/v1/finance/balances').set(as('finance')).expect(200);
    expect(b.body.find((w: any) => w.id === ids.pro)).toMatchObject({ ledgerBalance: 25_000 });
    const p = await http().get('/api/admin/v1/finance/payments?status=CONFIRMED').set(as('finance')).expect(200);
    expect(p.body.items.length).toBeGreaterThan(0);
  });

  it('reviews: reported or flagged ones are queued; hiding recomputes the rating; restoring brings it back', async () => {
    const j1 = await booked('COMPLETED');
    const j2 = await booked('COMPLETED');
    const good = await prisma.review.create({ data: { jobRequestId: j1.id, reviewerId: ids.cust, targetId: ids.pro, rating: 5, comment: 'Great work, on time' } });
    await http().post('/api/reviews').set(as('cust')).send({ jobRequestId: j2.id, rating: 1 }).expect(201); // bare 1-star: auto-flagged
    const bad = await prisma.review.findFirstOrThrow({ where: { jobRequestId: j2.id } });
    expect(bad.flagged).toBe(true);
    await http().post(`/api/reviews/${good.id}/report`).set(as('pro')).send({ reason: 'FALSE' }).expect(200);
    const q = await http().get('/api/admin/v1/moderation/reviews').set(as('content')).expect(200);
    expect(q.body.map((r: any) => r.id)).toEqual(expect.arrayContaining([good.id, bad.id]));
    await http().post(`/api/admin/v1/moderation/reviews/${bad.id}`).set(as('content')).send({ action: 'HIDE', note: 'No explanation' }).expect(200);
    expect((await prisma.worker.findUniqueOrThrow({ where: { id: ids.pro } })).rating).toBe(5);
    await http().post(`/api/admin/v1/moderation/reviews/${bad.id}`).set(as('content')).send({ action: 'RESTORE' }).expect(200);
    expect((await prisma.worker.findUniqueOrThrow({ where: { id: ids.pro } })).rating).toBe(3);
    await http().post(`/api/admin/v1/moderation/reviews/${good.id}`).set(as('content')).send({ action: 'DISMISS' }).expect(200);
    expect(await audited('review.hide', bad.id)).toBe(1);
  });

  it('catalogue: translations merge, common problems saved by code, price bands validated', async () => {
    await http().patch(`/api/admin/v1/catalog/categories/${plumbing}`).set(as('content')).send({ translations: { ur: { name: 'پلمبر' } } }).expect(200);
    const cat = await prisma.serviceCategory.findUniqueOrThrow({ where: { id: plumbing } });
    expect((cat.translations as any).ur.name).toBe('پلمبر');
    expect((cat.translations as any).ar).toBeTruthy(); // other languages kept
    await http().put(`/api/admin/v1/catalog/categories/${plumbing}/issues`).set(as('content')).send({ code: 'Bad Code', name: 'x' }).expect(400);
    await http().put(`/api/admin/v1/catalog/categories/${plumbing}/issues`).set(as('content')).send({ code: 'geyser_leak', name: 'Geyser leaking' }).expect(200);
    await http().put('/api/admin/v1/catalog/price-bands').set(as('content')).send({ categoryId: plumbing, city: 'Karachi', currency: 'PKR', minMinor: 200_000, maxMinor: 80_000 }).expect(400);
    await http().put('/api/admin/v1/catalog/price-bands').set(as('content')).send({ categoryId: plumbing, city: 'Karachi', currency: 'PKR', minMinor: 80_000, maxMinor: 200_000 }).expect(200);
    await http().put('/api/admin/v1/catalog/price-bands').set(as('analyst')).send({ categoryId: plumbing, city: 'Lahore', currency: 'PKR', minMinor: 1, maxMinor: 2 }).expect(403);
    await prisma.serviceIssue.deleteMany({ where: { code: 'geyser_leak' } });
    await prisma.priceBand.deleteMany({ where: { categoryId: plumbing } });
    await prisma.serviceCategory.update({ where: { id: plumbing }, data: { translations: cat.translations as any } });
  });

  it('country settings: Super Admin only, versioned, no silent overwrite, live at once', async () => {
    const cur = (await http().get('/api/admin/v1/config/countries/PK').set(as('finance')).expect(200)).body;
    const body = { commission: { rateBps: 1000, minMinor: 10_000, maxMinor: 150_000 }, cashLimits: cur.cashLimits, settlementRails: cur.settlementRails, emergencyNumbers: [...cur.emergencyNumbers, { label: 'Fire', number: '16' }], baseVersion: cur.version };
    await http().put('/api/admin/v1/config/countries/PK').set(as('finance')).send(body).expect(403);
    await http().put('/api/admin/v1/config/countries/PK').set(as('super')).send({ ...body, cashLimits: { ...cur.cashLimits, softMinor: 999_999_999 } }).expect(400);
    const saved = await http().put('/api/admin/v1/config/countries/PK').set(as('super')).send(body).expect(200);
    expect(saved.body.version).toBe(cur.version + 1);
    await http().put('/api/admin/v1/config/countries/PK').set(as('super')).send(body).expect(409); // stale baseVersion
    const nums = await http().get('/api/safety/emergency-numbers').set(as('cust')).expect(200);
    expect(nums.body.numbers.map((x: any) => x.number)).toContain('16');
    const v = (await http().get('/api/admin/v1/config/countries/PK').set(as('super')).expect(200)).body.versions;
    expect(v.map((x: any) => x.version)).toEqual(expect.arrayContaining([cur.version, cur.version + 1]));
    // put it back
    await http().put('/api/admin/v1/config/countries/PK').set(as('super')).send({ commission: cur.commission, cashLimits: cur.cashLimits, settlementRails: cur.settlementRails, emergencyNumbers: cur.emergencyNumbers, baseVersion: cur.version + 1 }).expect(200);
    expect(await audited('config.country_saved', 'PK')).toBeGreaterThanOrEqual(2);
  });

  it('feature flags change behaviour without a release, audited', async () => {
    await http().put('/api/admin/v1/config/flags/REQUIRE_JOB_PHOTOS').set(as('ops')).send({ value: false }).expect(403);
    await http().put('/api/admin/v1/config/flags/NOT_A_FLAG').set(as('super')).send({ value: true }).expect(404);
    await http().put('/api/admin/v1/config/flags/REQUIRE_JOB_PHOTOS').set(as('super')).send({ value: false }).expect(200);
    const j = await booked('ARRIVED');
    await http().post(`/api/job-requests/${j.id}/start`).set(as('pro')).send({}).expect(201); // no photo needed now
    await http().put('/api/admin/v1/config/flags/REQUIRE_JOB_PHOTOS').set(as('super')).send({ value: true }).expect(200);
    const flags = (await http().get('/api/admin/v1/config/flags').set(as('content')).expect(200)).body;
    expect(flags.find((f: any) => f.key === 'REQUIRE_JOB_PHOTOS')).toMatchObject({ value: true, setByStaff: true });
    await prisma.featureFlag.deleteMany({ where: { key: 'REQUIRE_JOB_PHOTOS' } });
  });

  it('the audit log is searchable, for auditors only', async () => {
    await http().get('/api/admin/v1/audit').set(as('finance')).expect(403);
    const r = await http().get(`/api/admin/v1/audit?actorId=${ids.super}&action=config.`).set(as('auditor')).expect(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((a: any) => a.actorId === ids.super && a.action.startsWith('config.'))).toBe(true);
  });

  it('suspending releases open jobs: requests cancelled, prices withdrawn, live bookings flagged for Ops', async () => {
    await user('cust2', 'customer');
    const open = await prisma.jobRequest.create({ data: { customerId: ids.cust2, customerName: 'c', title: 'Fan', description: 'x', status: 'MATCHES_FOUND', categoryId: plumbing, latitude: HOME.lat, longitude: HOME.lng } });
    const live = await prisma.jobRequest.create({ data: { customerId: ids.cust2, customerName: 'c', title: 'Tap', description: 'x', status: 'EN_ROUTE', assignedWorkerId: ids.pro, categoryId: plumbing, agreedAmount: 100_000, agreedCurrency: 'PKR', bookedAt: new Date() } });
    const other = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', title: 'Sink', description: 'x', status: 'MATCHES_FOUND', categoryId: plumbing } });
    await prisma.offer.create({ data: { jobRequestId: other.id, workerId: ids.pro2, amount: 90_000, currency: 'PKR', expiresAt: new Date(Date.now() + 3600_000) } });

    // Safety may suspend without being allowed to cancel jobs one by one.
    const r = await http().post(`/api/admin/v1/users/${ids.cust2}/suspend`).set(as('safety')).send({ reason: 'Abusive messages' }).expect(201);
    expect(r.body.cancelled).toEqual([open.id]);
    expect(r.body.activeBookings.map((j: any) => j.id)).toEqual([live.id]);
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('CANCELLED');
    expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('EN_ROUTE');
    expect(await prisma.jobEvent.count({ where: { jobRequestId: live.id, type: 'PARTY_SUSPENDED' } })).toBe(1);
    expect(await audited('user.suspension_jobs_released', ids.cust2)).toBe(1);

    const w = await http().post(`/api/admin/v1/users/${ids.pro2}/suspend`).set(as('ops')).send({ reason: 'Fake documents' }).expect(201);
    expect(w.body.offersWithdrawn).toBe(1);
    expect((await prisma.offer.findFirstOrThrow({ where: { jobRequestId: other.id } })).status).toBe('WITHDRAWN');
    await http().post(`/api/admin/v1/users/${ids.pro2}/reactivate`).set(as('ops')).send({ reason: 'Cleared' }).expect(200);
  });

  it('the older staff actions are audited too: documents, roles, two-step reset, disputes, settlements, catalogue', async () => {
    await user('pro3', 'worker', [], { lat: 24.9, lng: 67.0 });
    await user('temp', 'admin', ['Support']);
    const vc = await prisma.verificationCase.create({ data: { workerId: ids.pro3, type: 'ID', documentKeys: [] } });
    await http().post(`/api/admin/v1/verification-cases/${vc.id}/decision`).set(as('super')).send({ decision: 'NEEDS_INFO', reason: 'The photo is blurry' }).expect(201);

    await http().patch(`/api/admin/v1/staff/${ids.temp}/roles`).set(as('super')).send({ roles: ['Analytics'] }).expect(200);
    await prisma.user.update({ where: { id: ids.temp }, data: { totpEnabledAt: new Date() } });
    await http().post(`/api/admin/v1/staff/${ids.temp}/reset-2fa`).set(as('super')).send({ reason: 'Lost phone' }).expect(201);

    const j = await booked('AWAITING_CONFIRMATION', 'pro3');
    const d = await prisma.dispute.create({ data: { jobRequestId: j.id, raisedById: ids.cust, reason: 'Left a mess', evidenceKeys: [] } });
    await http().patch(`/api/disputes/${d.id}/resolve`).set(as('ops')).send({ status: 'RESOLVED', resolution: 'Worker came back to clean up' }).expect(200);

    const [s1, s2] = await Promise.all([1, 2].map((k) => prisma.settlement.create({ data: { workerId: ids.pro3, amount: 10_000 * k, currency: 'PKR', rail: 'JAZZCASH', reference: `REF-${tag}-${k}`, status: 'PENDING' } })));
    await http().post(`/api/admin/v1/settlements/${s1.id}/confirm`).set(as('finance')).send({}).expect(200);
    await http().post(`/api/admin/v1/settlements/${s2.id}/reject`).set(as('finance')).send({ note: 'No such reference' }).expect(200);

    const cat = (await http().post('/api/service-catalog/categories').set(as('content')).send({ name: `${tag}-CAT` }).expect(201)).body;
    await http().patch(`/api/service-catalog/categories/${cat.id}`).set(as('content')).send({ description: 'Test' }).expect(200);
    await http().patch('/api/service-catalog/categories/nope').set(as('content')).send({ description: 'Test' }).expect(404);
    const sv = (await http().post(`/api/service-catalog/categories/${cat.id}/services`).set(as('content')).send({ name: 'Thing' }).expect(201)).body;
    await http().patch(`/api/service-catalog/services/${sv.id}`).set(as('content')).send({ isActive: false }).expect(200);
    expect(await audited('catalog.service_updated', sv.id)).toBe(1);
    // Hidden items still show to staff, so they can be turned back on.
    const all = (await http().get('/api/admin/v1/catalog/categories').set(as('content')).expect(200)).body;
    expect(all.find((c: any) => c.id === cat.id).services[0]).toMatchObject({ id: sv.id, isActive: false });
    await http().get('/api/admin/v1/catalog/categories').set(as('finance')).expect(403);
  });

  // Last: every staff-only change route was called above and wrote an audit row (a new route without one fails here).
  it('every admin change is audited', () => {
    const reflector = app.get(Reflector);
    const mutations: string[] = [];
    for (const mod of app.get(ModulesContainer).values()) {
      for (const ctrl of mod.controllers.values()) {
        const cls = ctrl.metatype as any;
        if (!cls?.prototype) continue;
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          const fn = cls.prototype[name];
          if (name === 'constructor' || typeof fn !== 'function') continue;
          const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [fn, cls]);
          const method = Reflect.getMetadata(METHOD_METADATA, fn);
          if (!roles?.length || !roles.every((r) => r === 'admin') || !reflector.get(PERMISSION_KEY, fn) && !reflector.get(PERMISSION_KEY, cls)) continue;
          if (method === undefined || method === RequestMethod.GET) continue;
          mutations.push(`${cls.name}.${name}`);
        }
      }
    }
    expect(mutations.length).toBeGreaterThan(10);
    // A replay (double click) rightly adds nothing; a route is silent only if no call to it was audited.
    expect([...unauditedHandlers].filter((h) => !auditedHandlers.has(h))).toEqual([]);
    expect(mutations.filter((m) => !auditedHandlers.has(m)).sort()).toEqual([]);
  });
});
