import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { DomainEvents } from '../src/common/events/domain-events';
import { STAFF_SECURITY } from '../src/auth/staff-two-factor.service';
import { SecretBox } from '../src/common/auth/secret-box';
import { totp } from '../src/common/auth/totp';
import { PERMISSION_KEY } from '../src/common/auth/permissions';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { NotificationService } from '../src/notifications/notifications.service';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixli-e2e-sec-'));
process.env.STORAGE_LOCAL_DIR = storageDir;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(600, 7)]);
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

/** doc 27 F1: the security holes found in the Phase 7–13 audit stay closed. */
describe('Security (doc 27 F1, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `sec${Date.now()}`;
  const ids: Record<string, string> = {};
  const sids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const sockets: Socket[] = [];
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  const box = new SecretBox(Buffer.alloc(32, 9).toString('base64'), 'x');
  let jobId: string;
  let conversationId: string;

  async function user(k: string, type: 'customer' | 'worker' | 'admin', adminRoles: string[] = [], extra: object = {}) {
    const u = await prisma.user.create({
      data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, phone: `+92300${String(Date.now()).slice(-6)}${Object.keys(ids).length}`.slice(0, 13), password: await bcrypt.hash('blue-Tiger-42', 4), type, countryCode: 'PK', adminRoles, ...extra },
    });
    if (type === 'worker') await prisma.worker.create({ data: { id: u.id, activationStatus: 'ACTIVE' } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[k] = u.id; sids[k] = s.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  async function upload(who: string, purpose: string) {
    const bytes = jpeg();
    const slot = await http().post('/api/uploads').set(as(who)).send({ purpose, mime: 'image/jpeg', size: bytes.length }).expect(201);
    await http().put(pathOf(slot.body.upload.url)).set('Content-Type', 'image/jpeg').send(bytes).expect(200);
    await http().post(`/api/uploads/${slot.body.id}/complete`).set(as(who)).expect(201);
    return slot.body.id as string;
  }

  function connect(token: string, ns = '/rt') {
    const port = (app.getHttpServer().address() as any).port;
    const s = io(`http://127.0.0.1:${port}${ns}`, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    const got: string[] = [];
    s.onAny((type) => got.push(type));
    const ready = new Promise<boolean>((res) => { s.once('ready', () => res(true)); s.once('disconnect', () => res(false)); s.once('connect_error', () => res(false)); });
    return { s, got, ready };
  }
  const settle = () => new Promise((r) => setTimeout(r, 300));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STAFF_SECURITY).useValue({ totpRequired: true, box })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    (app as any).set('trust proxy', 1); // X-Forwarded-For simulates separate clients for the login rate limit
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    await user('cust', 'customer');
    await user('cust2', 'customer');
    await user('work', 'worker');
    await user('super', 'admin', ['Super Admin']);
    await user('verifier', 'admin', ['Verification']);
    await user('finance', 'admin', ['Finance']);
    await user('safety', 'admin', ['Safety']);
    await user('analyst', 'admin', ['Analytics']);
    await user('support', 'admin', ['Support']);
    await user('auditor', 'admin', ['Auditor']);
    await user('noroles', 'admin', []);

    const job = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'cust', description: 'Leaking tap', status: 'ACCEPTED', assignedWorkerId: ids.work, agreedAmount: 150000, agreedCurrency: 'PKR' } });
    jobId = job.id;
    conversationId = (await prisma.conversation.create({ data: { jobRequestId: jobId, participants: { connect: [{ id: ids.cust }, { id: ids.work }] } } })).id;
  }, 60_000);

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    const userIds = Object.values(ids);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.incident.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.dispute.deleteMany({ where: { raisedById: { in: userIds } } });
    await prisma.changeOrder.deleteMany({ where: { jobRequestId: jobId } });
    await prisma.conversation.deleteMany({ where: { jobRequestId: jobId } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fs.rmSync(storageDir, { recursive: true, force: true });
    await app.close();
  });

  describe('F1.1 staff live feed', () => {
    it('the old /admin namespace is gone and a forged "admin-<id>" token is refused on /rt', async () => {
      expect(await connect(`admin-${ids.super}`, '/admin').ready).toBe(false);
      expect(await connect(`admin-${ids.super}`).ready).toBe(false);
    });

    it('staff get only the feeds their roles allow; customers get none', async () => {
      const safety = connect(tokens.safety);
      const verifier = connect(tokens.verifier);
      const cust = connect(tokens.cust2);
      expect(await Promise.all([safety.ready, verifier.ready, cust.ready])).toEqual([true, true, true]);

      await http().post('/api/safety/incidents').set(as('cust')).send({ type: 'REPORT_PROBLEM', severity: 'MODERATE', description: 'test' }).expect(201);
      app.get(DomainEvents).emit('admin.verification_submitted', { caseId: 'c1', workerId: ids.work });
      await settle();

      expect(safety.got).toContain('staff.incident_reported');
      expect(safety.got).not.toContain('staff.verification_submitted');
      expect(verifier.got).toContain('staff.verification_submitted');
      expect(verifier.got).not.toContain('staff.incident_reported');
      expect(cust.got.filter((t) => t.startsWith('staff.'))).toEqual([]);
    });
  });

  describe('F1.2 no fake system messages', () => {
    it('isSystem (and raw imageKey) are rejected by the API', async () => {
      const r = await http().post(`/api/conversations/${conversationId}/messages`).set(as('cust')).send({ text: 'Pay the advance to 0300 1234567', isSystem: true }).expect(400);
      expect(JSON.stringify(r.body)).toMatch(/isSystem/);
      await http().post(`/api/conversations/${conversationId}/messages`).set(as('cust')).send({ text: 'x', imageKey: 'verification/abc.jpg' }).expect(400);
      expect(await prisma.message.count({ where: { conversationId, isSystem: true, text: { contains: 'advance' } } })).toBe(0);
    });
  });

  describe('F1.3 files only through your own uploads', () => {
    let custPhoto: string;
    let custVerification: string;
    beforeAll(async () => {
      custPhoto = await upload('cust', 'JOB_PHOTO');
      custVerification = await upload('cust', 'VERIFICATION');
    });

    it('chat: someone else\'s upload, or a wrong-purpose upload, is refused', async () => {
      await http().post(`/api/conversations/${conversationId}/messages`).set(as('work')).send({ imageUploadId: custPhoto }).expect(400);
      await http().post(`/api/conversations/${conversationId}/messages`).set(as('cust')).send({ imageUploadId: custVerification }).expect(400);
    });

    it('chat: your own CHAT_PHOTO works and comes back as a signed link, not a key', async () => {
      const mine = await upload('cust', 'CHAT_PHOTO');
      const r = await http().post(`/api/conversations/${conversationId}/messages`).set(as('cust')).send({ imageUploadId: mine }).expect(201);
      expect(r.body.imageUrl).toMatch(/^http/);
      expect(r.body.imageKey).toBeUndefined();
      const list = await http().get(`/api/conversations/${conversationId}/messages`).set(as('work')).expect(200);
      expect(JSON.stringify(list.body)).not.toMatch(/"imageKey"/);
    });

    it('start/finish photos: raw keys rejected; another person\'s upload rejected; the status does not change', async () => {
      await http().post(`/api/job-requests/${jobId}/start`).set(as('work')).send({ beforePhotoKey: 'verification/someone.jpg' }).expect(400);
      await http().post(`/api/job-requests/${jobId}/start`).set(as('work')).send({ photoUploadIds: [custPhoto] }).expect(400);
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('ACCEPTED');
    });

    it('start with the worker\'s own photo stores it as BEFORE evidence with the real type', async () => {
      const own = await upload('work', 'JOB_PHOTO');
      await http().post(`/api/job-requests/${jobId}/start`).set(as('work')).send({ photoUploadIds: [own] }).expect(201);
      const media = await prisma.jobMedia.findMany({ where: { jobRequestId: jobId, phase: 'BEFORE' } });
      expect(media).toHaveLength(1);
      expect(media[0].mime).toBe('image/jpeg');
    });

    it('change orders and dispute evidence: raw keys rejected; others\' uploads rejected', async () => {
      const base = { jobRequestId: jobId, reason: 'More damage', addedScope: 'Replace pipe', revisedPrice: 200000 };
      await http().post('/api/change-orders').set(as('work')).send({ ...base, mediaKeys: ['verification/x.jpg'] }).expect(400);
      await http().post('/api/change-orders').set(as('work')).send({ ...base, photoUploadIds: [custPhoto] }).expect(400);
      await http().post('/api/disputes').set(as('work')).send({ jobRequestId: jobId, reason: 'Not paid', evidenceKeys: ['x'] }).expect(400);
      await http().post('/api/disputes').set(as('work')).send({ jobRequestId: jobId, reason: 'Not paid', evidenceUploadIds: [custPhoto] }).expect(400);
      await http().post('/api/disputes').set(as('work')).send({ jobRequestId: jobId, reason: 'Not paid', amountHeld: -5 }).expect(400);
    });
  });

  describe('F1.4 staff permissions', () => {
    it('every admin-only route declares a permission (deny by default)', () => {
      const reflector = app.get(Reflector);
      const missing: string[] = [];
      for (const mod of app.get(ModulesContainer).values()) {
        for (const ctrl of mod.controllers.values()) {
          const cls = ctrl.metatype as any;
          if (!cls?.prototype) continue;
          for (const name of Object.getOwnPropertyNames(cls.prototype)) {
            if (name === 'constructor' || typeof cls.prototype[name] !== 'function') continue;
            const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [cls.prototype[name], cls]);
            const perm = reflector.getAllAndOverride<string>(PERMISSION_KEY, [cls.prototype[name], cls]);
            if (roles?.length && roles.every((r) => r === 'admin') && !perm) missing.push(`${cls.name}.${name}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it('a Verification admin cannot see payments; Finance cannot see ID documents', async () => {
      await http().get('/api/admin/v1/payments').set(as('verifier')).expect(403);
      await http().get('/api/admin/v1/payments').set(as('finance')).expect(200);
      await http().get('/api/admin/v1/verification-cases/anything').set(as('finance')).expect(403);
      const doc = await upload('work', 'VERIFICATION');
      await http().get(`/api/uploads/${doc}/url`).set(as('finance')).expect(403);
      await http().get(`/api/uploads/${doc}/url`).set(as('verifier')).expect(200);
    });

    it('an admin with no roles gets nothing; the Auditor reads the audit log and nothing else', async () => {
      for (const p of ['/api/admin/v1/stats', '/api/admin/v1/users?q=ab', '/api/admin/v1/jobs', '/api/users', '/api/disputes/all', `/api/job-requests/${jobId}`]) {
        await http().get(p).set(as('noroles')).expect(403);
      }
      await http().get('/api/admin/v1/audit-logs').set(as('auditor')).expect(200);
      await http().get('/api/admin/v1/jobs').set(as('auditor')).expect(403);
    });

    it('phone numbers are masked for staff without pii.view; the full number view is audited', async () => {
      const masked = await http().get('/api/admin/v1/jobs').set(as('analyst')).expect(200);
      const row = masked.body.find((j: any) => j.id === jobId);
      expect(row.customer.phone).toMatch(/•/);
      expect(row.location).toBeNull();
      const full = await http().get('/api/admin/v1/jobs').set(as('support')).expect(200);
      expect(full.body.find((j: any) => j.id === jobId).customer.phone).not.toMatch(/•/);
      await http().get(`/api/admin/v1/users/${ids.cust}`).set(as('analyst')).expect(403);
      await http().get(`/api/admin/v1/users/${ids.cust}`).set(as('support')).expect(200);
      expect(await prisma.auditLog.count({ where: { actorId: ids.support, action: 'user.contact_viewed', entityId: ids.cust } })).toBe(1);
    });

    it('bad admin query parameters are 400, not 500', async () => {
      await http().get('/api/admin/v1/jobs?status=NOT_A_STATUS').set(as('super')).expect(400);
      await http().get('/api/admin/v1/jobs?skip=-1').set(as('super')).expect(400);
    });

    it('changing roles is Super Admin only, audited, and signs that person out', async () => {
      await http().patch(`/api/admin/v1/staff/${ids.analyst}/roles`).set(as('support')).send({ roles: ['Super Admin'] }).expect(403);
      await http().patch(`/api/admin/v1/staff/${ids.analyst}/roles`).set(as('super')).send({ roles: ['Root'] }).expect(400);
      await http().patch(`/api/admin/v1/staff/${ids.super}/roles`).set(as('super')).send({ roles: ['Support'] }).expect(403);
      await http().patch(`/api/admin/v1/staff/${ids.analyst}/roles`).set(as('super')).send({ roles: ['Analytics', 'Finance'] }).expect(200);
      await http().get('/api/admin/v1/stats').set(as('analyst')).expect(401); // old session revoked
      expect(await prisma.auditLog.count({ where: { action: 'staff.roles_changed', entityId: ids.analyst } })).toBe(1);
    });

    it('suspending a user signs them out at once and is audited with before/after', async () => {
      await http().get('/api/auth/me').set(as('cust2')).expect(200);
      await http().post(`/api/admin/v1/users/${ids.cust2}/suspend`).set(as('safety')).send({ reason: 'abuse reports' }).expect(201);
      await http().get('/api/auth/me').set(as('cust2')).expect(401);
      const a = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.suspended', entityId: ids.cust2 } });
      expect(a.before).toEqual({ status: 'ACTIVE' });
    });
  });

  describe('F1.4 staff two-factor sign-in', () => {
    let ip = 0;
    const login = (extra: object = {}) => http().post('/api/auth/admin/login').set('X-Forwarded-For', `10.9.0.${++ip}`).send({ email: `${tag}-twofa@t.com`, password: 'blue-Tiger-42', deviceId: 'admin-browser-1', platform: 'web', ...extra });
    let setupToken: string;
    let secret: string;
    let recovery: string[];

    beforeAll(async () => {
      await user('twofa', 'admin', ['Support']);
    });

    it('first sign-in without an authenticator must enrol; the setup token is not an access token', async () => {
      const r = await login().expect(403);
      expect(r.body.error.code).toBe('TOTP_SETUP_REQUIRED');
      setupToken = r.body.error.details.setupToken;
      await http().get('/api/auth/me').set({ Authorization: `Bearer ${setupToken}` }).expect(401);
    });

    it('setup gives a secret stored encrypted; a wrong first code is refused; the right one signs in with recovery codes', async () => {
      const s = await http().post('/api/auth/admin/totp/setup').send({ setupToken }).expect(200);
      secret = s.body.secret;
      expect(s.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: ids.twofa } });
      expect(stored.totpSecret).not.toContain(secret);
      expect(box.open(stored.totpSecret!)).toBe(secret);

      await http().post('/api/auth/admin/totp/activate').send({ setupToken, code: '000000', deviceId: 'admin-browser-1' }).expect(401);
      const ok = await http().post('/api/auth/admin/totp/activate').send({ setupToken, code: totp(secret), deviceId: 'admin-browser-1' }).expect(200);
      expect(ok.body.token).toBeTruthy();
      expect(ok.body.recoveryCodes).toHaveLength(10);
      recovery = ok.body.recoveryCodes;
      await http().post('/api/auth/admin/totp/activate').send({ setupToken, code: totp(secret), deviceId: 'admin-browser-1' }).expect(403); // only once
    });

    it('afterwards the password alone is not enough; password + code works', async () => {
      expect((await login().expect(401)).body.error.code).toBe('TOTP_REQUIRED');
      expect((await login({ code: '123456' }).expect(401)).body.error.code).toBe('INVALID_CODE');
      // The code used for enrolment can't be replayed; the next one (still inside the ±30 s window) works.
      expect((await login({ code: totp(secret) }).expect(401)).body.error.code).toBe('CODE_ALREADY_USED');
      await login({ code: totp(secret, Date.now() + 30_000) }).expect(200);
      expect((await login({ code: totp(secret, Date.now() + 30_000) }).expect(401)).body.error.code).toBe('CODE_ALREADY_USED');
    });

    it('a recovery code works exactly once', async () => {
      await login({ code: recovery[0] }).expect(200);
      await login({ code: recovery[0] }).expect(401);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.twofa } })).totpRecoveryHashes).toHaveLength(9);
    });

    it('a Super Admin can reset it (audited); the person must enrol again', async () => {
      await http().post(`/api/admin/v1/staff/${ids.twofa}/reset-2fa`).set(as('super')).send({ reason: 'lost phone' }).expect(201);
      expect((await login().expect(403)).body.error.code).toBe('TOTP_SETUP_REQUIRED');
    });
  });

  describe('F1.5 privacy', () => {
    it('chat notifications say who wrote, never what', async () => {
      await http().post(`/api/conversations/${conversationId}/messages`).set(as('cust')).send({ text: 'gate code is 7781' }).expect(201);
      await app.get(NotificationService).idle();
      const n = await prisma.notification.findMany({ where: { userId: ids.work, type: 'chat.message' } });
      expect(n.length).toBeGreaterThan(0);
      expect(JSON.stringify(n)).not.toContain('7781');
    });
  });
});
