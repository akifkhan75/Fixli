import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from '../src/safety/sms.provider';

const PASSWORD = 'blue-Tiger-42';

/** Phone verification, signup gating and password reset against a real database (doc 27 R5). */
describe('Identity: OTP signup & password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const inbox: { phone: string; text: string }[] = [];
  const http = () => request(app.getHttpServer());
  const stamp = String(Date.now()).slice(-7);
  let n = 0;
  const local = () => `0311${stamp.slice(0, 4)}${String(++n).padStart(3, '0')}`; // 11 digits
  const e164 = (l: string) => `+92${l.slice(1)}`;
  const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const codeFor = (phone: string) => /(\d{6})/.exec([...inbox].reverse().find((m) => m.phone === phone)!.text)![1];
  const ageCodes = (phone: string) => prisma.phoneVerification.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 120_000) } });
  const device = { deviceId: 'e2e-otp-device-1' };
  const start = (phone: string, from = ip()) => http().post('/api/auth/phone/start').set('X-Forwarded-For', from).send({ phone, countryCode: 'PK' });

  beforeAll(async () => {
    // Config is validated when AppModule is imported, so switch OTP on here rather than via process.env.
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER).useValue({ configured: true, send: async (phone: string, text: string) => { inbox.push({ phone, text }); return { delivered: true }; } })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    (app as any).set('trust proxy', 1); // so X-Forwarded-For simulates different clients
    const cfg = app.get(ConfigService);
    const realGet = cfg.get.bind(cfg) as (k: string, ...r: unknown[]) => unknown;
    jest.spyOn(cfg, 'get').mockImplementation(((k: string, ...r: unknown[]) => (k === 'OTP_REQUIRED' ? true : realGet(k, ...r))) as never);
    await app.init();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('signup without a verified phone is refused', async () => {
    const res = await http().post('/api/auth/signup').set('X-Forwarded-For', ip())
      .send({ name: 'No Code', phone: local(), countryCode: 'PK', password: PASSWORD, type: 'customer', ...device }).expect(400);
    expect(JSON.stringify(res.body)).toContain('PHONE_NOT_VERIFIED');
  });

  it('start -> verify -> signup works once; the token cannot be replayed or used for another number', async () => {
    const l = local(); const phone = e164(l);
    await start(l).expect(200);
    expect(inbox.some((m) => m.phone === phone)).toBe(true);
    const wrong = await http().post('/api/auth/phone/verify').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', code: codeFor(phone) === '000000' ? '111111' : '000000' }).expect(400);
    expect(JSON.stringify(wrong.body)).toContain('INVALID_CODE');
    const ok = await http().post('/api/auth/phone/verify').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', code: codeFor(phone) }).expect(200);
    const signupToken = ok.body.signupToken as string;
    expect(signupToken).toBeTruthy();

    const other = await http().post('/api/auth/signup').set('X-Forwarded-For', ip())
      .send({ name: 'Other', phone: local(), countryCode: 'PK', password: PASSWORD, type: 'customer', signupToken, ...device }).expect(400);
    expect(JSON.stringify(other.body)).toContain('PHONE_NOT_VERIFIED');

    await http().post('/api/auth/signup').set('X-Forwarded-For', ip())
      .send({ name: 'Real User', phone: l, countryCode: 'PK', password: PASSWORD, type: 'customer', signupToken, ...device }).expect(201);
    const replay = await http().post('/api/auth/signup').set('X-Forwarded-For', ip())
      .send({ name: 'Replay', phone: l, countryCode: 'PK', password: PASSWORD, type: 'customer', signupToken, ...device }).expect(400);
    expect(JSON.stringify(replay.body)).toContain('PHONE_NOT_VERIFIED');
  });

  it('does not reveal registered numbers: start answers the same and sends no code', async () => {
    const l = local(); const phone = e164(l);
    await prisma.user.create({ data: { name: 'Existing', phone, countryCode: 'PK', password: 'x', type: 'customer' } });
    const fresh = await start(local()).expect(200);
    const taken = await start(l).expect(200);
    expect(Object.keys(taken.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(inbox.some((m) => m.phone === phone)).toBe(false);
  });

  it('enforces the resend cooldown', async () => {
    const l = local();
    await start(l).expect(200);
    const again = await start(l).expect(429);
    expect(JSON.stringify(again.body)).toContain('OTP_COOLDOWN');
  });

  it('password reset: wrong code fails, right code sets a new password and signs out every device', async () => {
    const l = local(); const phone = e164(l);
    // Create through the real signup so a session exists.
    await start(l).expect(200);
    const v = await http().post('/api/auth/phone/verify').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', code: codeFor(phone) }).expect(200);
    const su = await http().post('/api/auth/signup').set('X-Forwarded-For', ip())
      .send({ name: 'Forgetful', phone: l, countryCode: 'PK', password: PASSWORD, type: 'customer', signupToken: v.body.signupToken, ...device }).expect(201);
    const oldRefresh = su.body.refreshToken as string;

    await ageCodes(phone);
    await http().post('/api/auth/password/forgot').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK' }).expect(200);
    const code = codeFor(phone);
    const bad = await http().post('/api/auth/password/reset').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', code: code === '000000' ? '111111' : '000000', newPassword: 'green-Falcon-77' }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('INVALID_CODE');
    await http().post('/api/auth/password/reset').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', code, newPassword: 'green-Falcon-77' }).expect(200);
    // One use only.
    await http().post('/api/auth/password/reset').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', code, newPassword: 'purple-Otter-55' }).expect(400);

    await http().post('/api/auth/login').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', password: PASSWORD, ...device }).expect(401);
    await http().post('/api/auth/login').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK', password: 'green-Falcon-77', ...device }).expect(200);
    await http().post('/api/auth/refresh').set('X-Forwarded-For', ip()).send({ refreshToken: oldRefresh }).expect(401);
  });

  it('forgot-password for an unknown number answers 200 and sends nothing', async () => {
    const l = local();
    await http().post('/api/auth/password/forgot').set('X-Forwarded-For', ip()).send({ phone: l, countryCode: 'PK' }).expect(200);
    expect(inbox.some((m) => m.phone === e164(l))).toBe(false);
  });
});
