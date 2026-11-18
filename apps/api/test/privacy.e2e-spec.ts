import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { encryptField, decryptField } from '../src/common/crypto/field-crypto';
import { encryptIdNumbers } from '../prisma/encrypt-id-numbers';

const PASSWORD = 'correct-horse-9';

/** Account erasure and identity-number protection against a real database (doc 27 R4). */
describe('Privacy: account deletion & ID numbers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `prv${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const phones: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let n = 0;

  async function user(k: string, type: 'customer' | 'worker' | 'admin', extra: Record<string, unknown> = {}) {
    const phone = type === 'admin' ? undefined : `+9230${String(Date.now()).slice(-8)}${++n}`.slice(0, 13);
    const u = await prisma.user.create({
      data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone, password: await bcrypt.hash(PASSWORD, 4), type, countryCode: 'PK', ...extra } as any,
    });
    if (type === 'worker') await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE', isOnline: true, isVerified: true, bio: 'I fix taps', serviceLat: 24.9, serviceLng: 67.1, serviceAreaLabel: 'Gulshan' } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3_600_000), pushToken: 'ExponentPushToken[x]' } });
    ids[k] = u.id; phones[k] = phone ?? '';
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
    return u;
  }
  const job = (customer: string, over: Record<string, unknown> = {}) =>
    prisma.jobRequest.create({ data: { customerId: ids[customer], customerName: `${customer} Person`, description: 'Kitchen tap leaks, house 12', location: 'House 12, Gulshan', latitude: 24.92, longitude: 67.09, area: 'Gulshan', city: 'Karachi', status: 'MATCHES_FOUND', ...over } as any });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  }, 60_000);

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.incident.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.jobRequest.deleteMany({ where: { OR: [{ customerId: { in: userIds } }, { assignedWorkerId: { in: userIds } }] } });
    // The ledger is append-only, so a user who has ledger rows can never be deleted: take them offline instead.
    const keep = new Set((await prisma.ledgerEntry.findMany({ where: { workerId: { in: userIds } }, select: { workerId: true } })).map((l) => l.workerId));
    await prisma.worker.updateMany({ where: { id: { in: [...keep] } }, data: { isOnline: false } });
    const removable = userIds.filter((id) => !keep.has(id));
    await prisma.workingHours.deleteMany({ where: { workerId: { in: removable } } });
    await prisma.worker.deleteMany({ where: { id: { in: removable } } });
    await prisma.user.deleteMany({ where: { id: { in: removable } } });
    await app.close();
  });

  describe('account deletion', () => {
    it('needs the password and is not reachable without a session', async () => {
      await user('cust', 'customer');
      await http().delete('/api/users/me').send({ password: PASSWORD }).expect(401);
      await http().delete('/api/users/me').set(as('cust')).send({}).expect(400);
      await http().delete('/api/users/me').set(as('cust')).send({ password: 'wrong-wrong' }).expect(401);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.cust } })).status).toBe('ACTIVE');
    });

    it('a customer: open jobs are cancelled, personal data is erased, every session dies', async () => {
      const c = ids.cust;
      await prisma.address.create({ data: { userId: c, streetAddress: 'House 12', city: 'Karachi', country: 'PK', latitude: 24.92, longitude: 67.09 } });
      await prisma.trustedContact.create({ data: { userId: c, name: 'Ali', phone: '+923001112223' } });
      await prisma.notification.create({ data: { userId: c, type: 'job.accepted', title: 't', body: 'b', data: {}, eventKey: `${tag}-n` } });
      await prisma.upload.create({ data: { ownerId: c, purpose: 'JOB_PHOTO', key: `${tag}/photo.jpg`, mime: 'image/jpeg', size: 10, status: 'READY' } });
      await prisma.incident.create({ data: { reporterId: c, type: 'SOS', severity: 'LIFE_THREATENING', description: 'secret', latitude: 24.9, longitude: 67.1 } });
      const open = await job('cust');
      const done = await job('cust', { status: 'COMPLETED' });

      await http().delete('/api/users/me').set(as('cust')).send({ password: PASSWORD }).expect(200);

      const u = await prisma.user.findUniqueOrThrow({ where: { id: c } });
      expect(u).toMatchObject({ status: 'DELETED', name: 'Deleted user', email: null, phone: `deleted-${c}`, profileImageUrl: null });
      expect(await bcrypt.compare(PASSWORD, u.password)).toBe(false);
      expect(await prisma.address.count({ where: { userId: c } })).toBe(0);
      expect(await prisma.trustedContact.count({ where: { userId: c } })).toBe(0);
      expect(await prisma.notification.count({ where: { userId: c } })).toBe(0);
      expect(await prisma.upload.count({ where: { ownerId: c } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: c } })).toBe(0);
      const inc = await prisma.incident.findFirstOrThrow({ where: { reporterId: c } });
      expect(inc).toMatchObject({ description: null, latitude: null, longitude: null });
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('CANCELLED');
      for (const id of [open.id, done.id]) {
        expect(await prisma.jobRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ customerName: 'Deleted user', description: '[removed]', location: null, latitude: null, longitude: null, area: null });
      }
      // the old token no longer works, nor does logging in again
      await http().get('/api/users/me').set(as('cust')).expect(401);
      await http().post('/api/auth/login').send({ phone: phones.cust, password: PASSWORD, country: 'PK' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
      // repeating is harmless
      await http().delete('/api/users/me').set(as('cust')).send({ password: PASSWORD }).expect((r) => expect([200, 401]).toContain(r.status));
    });

    it('is refused while work is in progress or money is owed, and then changes nothing', async () => {
      await user('busyCust', 'customer');
      await user('owing', 'worker');
      const active = await job('busyCust', { status: 'IN_PROGRESS', assignedWorkerId: ids.owing });
      await http().delete('/api/users/me').set(as('busyCust')).send({ password: PASSWORD }).expect(409).expect((r) => expect(JSON.stringify(r.body)).toContain('JOB_IN_PROGRESS'));
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.busyCust } })).status).toBe('ACTIVE');
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: active.id } })).status).toBe('IN_PROGRESS');

      await prisma.jobRequest.update({ where: { id: active.id }, data: { status: 'COMPLETED' } });
      await prisma.ledgerEntry.create({ data: { workerId: ids.owing, type: 'COMMISSION_OWED', amount: -12_000, currency: 'PKR', balanceAfter: -12_000 } });
      await http().delete('/api/users/me').set(as('owing')).send({ password: PASSWORD }).expect(409).expect((r) => expect(JSON.stringify(r.body)).toContain('COMMISSION_OWED'));
      expect((await prisma.worker.findUniqueOrThrow({ where: { id: ids.owing } })).bio).toBe('I fix taps');
    });

    it('a worker: profile, location, documents (with the encrypted ID number) and pending offers are erased', async () => {
      await user('pro', 'worker');
      await prisma.verificationCase.create({ data: { workerId: ids.pro, type: 'ID', documentKeys: [`${tag}/front.jpg`], reference: encryptField('42101-1234567-1') } });
      await prisma.portfolioItem.create({ data: { workerId: ids.pro, title: 'Sink', photoKeys: [`${tag}/p.jpg`] } });
      await http().delete('/api/users/me').set(as('pro')).send({ password: PASSWORD }).expect(200);
      expect(await prisma.verificationCase.count({ where: { workerId: ids.pro } })).toBe(0);
      expect(await prisma.portfolioItem.count({ where: { workerId: ids.pro } })).toBe(0);
      expect(await prisma.worker.findUniqueOrThrow({ where: { id: ids.pro } })).toMatchObject({ isOnline: false, isVerified: false, bio: null, serviceLat: null, serviceLng: null, serviceAreaLabel: null, activationStatus: 'INACTIVE' });
    });

    it('the audit log records the deletion without personal data', async () => {
      const a = await prisma.auditLog.findFirst({ where: { action: 'account.deleted', entityId: ids.pro } });
      expect(a).toBeTruthy();
      expect(JSON.stringify(a)).not.toMatch(/Person|@t\.com|\+92/);
    });
  });

  describe('identity numbers', () => {
    let caseId: string;
    const CNIC = '42101-7654321-9';

    beforeAll(async () => {
      await user('worker2', 'worker');
      await user('verifier', 'admin', { adminRoles: ['Verification'] });
      await user('compliance', 'admin', { adminRoles: ['Compliance'] });
      caseId = (await prisma.verificationCase.create({ data: { workerId: ids.worker2, type: 'ID', documentKeys: [], reference: encryptField(CNIC) } })).id;
    });

    it('the queue and the detail only ever show the masked number', async () => {
      const q = await http().get('/api/admin/v1/verification-cases').set(as('verifier')).expect(200);
      const row = q.body.items.find((c: any) => c.id === caseId);
      expect(row.referenceMasked).toBe('42101-*******-9');
      expect(JSON.stringify(q.body)).not.toContain('7654321');
      const d = await http().get(`/api/admin/v1/verification-cases/${caseId}`).set(as('verifier')).expect(200);
      expect(d.body.referenceMasked).toBe('42101-*******-9');
      expect(JSON.stringify(d.body)).not.toContain('7654321');
    });

    it('only the Compliance role can reveal it, and every reveal is audited', async () => {
      await http().post(`/api/admin/v1/verification-cases/${caseId}/reveal-reference`).set(as('verifier')).expect(403);
      await http().post(`/api/admin/v1/verification-cases/${caseId}/reveal-reference`).set(as('worker2')).expect(403);
      expect(await prisma.auditLog.count({ where: { action: 'verification.reference_revealed', entityId: caseId } })).toBe(0);
      const r = await http().post(`/api/admin/v1/verification-cases/${caseId}/reveal-reference`).set(as('compliance')).expect(201);
      expect(r.body.reference).toBe(CNIC);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'verification.reference_revealed', entityId: caseId } });
      expect(audit.actorId).toBe(ids.compliance);
      expect(JSON.stringify(audit)).not.toContain('7654321');
    });

    it('the backfill encrypts legacy plaintext once and leaves encrypted rows alone', async () => {
      const legacy = await prisma.verificationCase.create({ data: { workerId: ids.worker2, type: 'ID', documentKeys: [], reference: '42101-1111111-1' } });
      const first = await encryptIdNumbers(prisma as any);
      expect(first.encrypted).toBeGreaterThanOrEqual(1);
      const stored = (await prisma.verificationCase.findUniqueOrThrow({ where: { id: legacy.id } })).reference!;
      expect(stored.startsWith('v1:')).toBe(true);
      expect(decryptField(stored)).toBe('42101-1111111-1');
      const second = await encryptIdNumbers(prisma as any);
      expect(second.encrypted).toBe(0);
      expect((await prisma.verificationCase.findUniqueOrThrow({ where: { id: legacy.id } })).reference).toBe(stored);
    });
  });
});
