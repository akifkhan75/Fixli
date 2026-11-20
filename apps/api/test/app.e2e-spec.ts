import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Auth & public endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  // The signup limit is per client IP (5/min), so tests that need many signups use distinct IPs.
  const signupFrom = (ip: string, body: object) => http().post('/api/auth/signup').set('X-Forwarded-For', ip).send(body);
  // Valid Pakistani mobile numbers, unique per run.
  const suffix = String(Date.now()).slice(-7);
  const phoneLocal = `0301 ${suffix}`;
  const phoneE164 = `+92301${suffix}`;
  const device = { deviceId: 'e2e-device-0001', deviceName: 'e2e', platform: 'android' };
  const cleanupPhones = [phoneE164];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    (app as any).set('trust proxy', 1); // so X-Forwarded-For can simulate different clients, as behind a real proxy
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    await app.listen(0); // one real listener: supertest otherwise opens a new server per request and flakes under load
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { phone: { in: cleanupPhones } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.worker.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('GET /api/health is public', () =>
    http().get('/api/health').expect(200).expect((r) => expect(r.body.service).toBe('fixli-api')));

  it('GET /api/config/countries is public and only Pakistan is open', async () => {
    const res = await http().get('/api/config/countries').expect(200);
    expect(res.body.find((c: any) => c.code === 'PK')).toMatchObject({ enabled: true, dialCode: '92' });
    expect(res.body.filter((c: any) => c.enabled).map((c: any) => c.code)).toEqual(['PK']);
  });

  describe('phone + password auth', () => {
    const signupBody = { name: 'E2E Customer', phone: phoneLocal, countryCode: 'PK', password: 'blue-Tiger-42', type: 'customer', ...device };
    let access: string;
    let refresh: string;
    let userId: string;

    it('signs up, normalising the number and never returning the password', async () => {
      const res = await http().post('/api/auth/signup').send(signupBody).expect(201);
      expect(res.body.user.phone).toBe(phoneE164);
      expect(res.body.user.type).toBe('customer');
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
      expect(res.body.token).toBeTruthy();
      expect(res.body.refreshToken).toMatch(/^[^.]+\..+/);
      access = res.body.token;
      refresh = res.body.refreshToken;
      userId = res.body.user.id;
    });

    it('stores a hashed password and a hashed refresh token', async () => {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      expect(u?.password).toMatch(/^\$2[aby]\$/);
      const s = await prisma.session.findFirst({ where: { userId } });
      expect(s?.refreshTokenHash).toHaveLength(64);
      expect(refresh).not.toContain(s!.refreshTokenHash);
    });

    it('the access token works on a protected route', async () => {
      const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${access}`).expect(200);
      expect(res.body.id).toBe(userId);
    });

    it('rejects a duplicate number in any format', async () => {
      const res = await http().post('/api/auth/signup').send({ ...signupBody, phone: phoneE164 }).expect(409);
      expect(res.body.error.code).toBe('PHONE_TAKEN');
    });

    it('rejects bad input with specific, friendly errors', async () => {
      const short = await signupFrom('10.1.0.1', { ...signupBody, phone: '0301 12' }).expect(400);
      expect(short.body.error.code).toBe('INVALID_PHONE');
      expect(short.body.error.message).toMatch(/too short/i);
      const weak = await signupFrom('10.1.0.2', { ...signupBody, phone: '0302 7654321', password: 'password123' }).expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      const closed = await signupFrom('10.1.0.3', { ...signupBody, phone: '+971501234567', countryCode: 'AE' }).expect(400);
      expect(closed.body.error.code).toBe('COUNTRY_NOT_AVAILABLE');
      const admin = await signupFrom('10.1.0.4', { ...signupBody, phone: '0302 7654321', type: 'admin' }).expect(400);
      expect(admin.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('logs in with the number typed differently', async () => {
      for (const phone of [phoneLocal, phoneE164, `0092${phoneE164.slice(3)}`]) {
        const res = await http().post('/api/auth/login').send({ phone, countryCode: 'PK', password: 'blue-Tiger-42', deviceId: 'e2e-device-0002' }).expect(200);
        expect(res.body.user.id).toBe(userId);
      }
    });

    it('wrong password and unknown number are indistinguishable', async () => {
      const wrong = await http().post('/api/auth/login').send({ phone: phoneLocal, countryCode: 'PK', password: 'nope-nope-1', deviceId: 'e2e-device-0003' }).expect(401);
      const unknown = await http().post('/api/auth/login').send({ phone: '0309 9999999', countryCode: 'PK', password: 'nope-nope-1', deviceId: 'e2e-device-0003' }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('rotates refresh tokens and detects reuse', async () => {
      const first = await http().post('/api/auth/refresh').send({ refreshToken: refresh }).expect(200);
      expect(first.body.refreshToken).not.toBe(refresh);
      const oldRefresh = refresh;
      refresh = first.body.refreshToken;
      access = first.body.token;

      // The new access token works.
      await http().get('/api/auth/me').set('Authorization', `Bearer ${access}`).expect(200);

      // Replaying the rotated token right away is treated as a race (retry), not a theft...
      await http().post('/api/auth/refresh').send({ refreshToken: oldRefresh }).expect(409);
      // ...but after the grace window it revokes the session.
      await prisma.session.updateMany({ where: { userId }, data: { lastUsedAt: new Date(Date.now() - 60_000) } });
      await http().post('/api/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: refresh }).expect(401);
      await http().get('/api/auth/me').set('Authorization', `Bearer ${access}`).expect(401);
    });

    it('logout kills the session immediately, even though the JWT has not expired', async () => {
      const login = await http().post('/api/auth/login').send({ phone: phoneLocal, countryCode: 'PK', password: 'blue-Tiger-42', deviceId: 'e2e-device-0004' }).expect(200);
      const auth = { Authorization: `Bearer ${login.body.token}` };
      await http().get('/api/auth/me').set(auth).expect(200);
      await http().post('/api/auth/logout').set(auth).expect(200);
      await http().get('/api/auth/me').set(auth).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    });

    it('changing the password signs out other devices but not this one', async () => {
      const a = await http().post('/api/auth/login').send({ phone: phoneLocal, countryCode: 'PK', password: 'blue-Tiger-42', deviceId: 'e2e-device-0005' }).expect(200);
      const b = await http().post('/api/auth/login').send({ phone: phoneLocal, countryCode: 'PK', password: 'blue-Tiger-42', deviceId: 'e2e-device-0006' }).expect(200);
      await http().post('/api/auth/password/change').set('Authorization', `Bearer ${a.body.token}`).send({ currentPassword: 'blue-Tiger-42', newPassword: 'green-Falcon-77' }).expect(200);
      await http().get('/api/auth/me').set('Authorization', `Bearer ${a.body.token}`).expect(200);
      await http().get('/api/auth/me').set('Authorization', `Bearer ${b.body.token}`).expect(401);
      await http().post('/api/auth/login').send({ phone: phoneLocal, countryCode: 'PK', password: 'blue-Tiger-42', deviceId: 'e2e-device-0007' }).expect(401);
    });

    it('a worker signs up unapproved and cannot be created as an admin', async () => {
      const wPhone = `+92302${suffix}`;
      cleanupPhones.push(wPhone);
      const res = await signupFrom('10.1.0.5', { ...signupBody, phone: wPhone, type: 'worker', deviceId: 'e2e-device-0008' }).expect(201);
      const worker = await prisma.worker.findUnique({ where: { id: res.body.user.id } });
      expect(worker?.activationStatus).toBe('ONBOARDING');
      await http().get('/api/workers').set('Authorization', `Bearer ${res.body.token}`).expect(200)
        .expect((r) => expect(r.body.find((w: any) => w.id === res.body.user.id)).toBeUndefined());
    });
  });

  describe('admin login', () => {
    it('customers cannot use the staff login', async () => {
      await http().post('/api/auth/admin/login').send({ email: 'nobody@example.com', password: 'whatever-1', deviceId: 'e2e-device-0009' }).expect(401);
    });
  });

  describe('public catalog', () => {
    it('roadmap APIs are hidden (404) until their feature is enabled', async () => {
      await http().get('/api/service-packages').expect(404);
      await http().get('/api/subscription-plans').expect(404);
    });
    it('/api/workers needs a token', () => http().get('/api/workers').expect(401));
  });
});
