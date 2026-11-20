import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { OtpService, OTP_MAX_ATTEMPTS } from './otp.service';

describe('OtpService', () => {
  const rows: any[] = [];
  const prisma: any = {
    phoneVerification: {
      findFirst: jest.fn(async ({ where }: any) => [...rows].reverse().find((r) => r.phone === where.phone && r.purpose === where.purpose && (where.consumedAt === null ? r.consumedAt === null : true)) ?? null),
      count: jest.fn(async () => rows.length),
      create: jest.fn(async ({ data }: any) => { const r = { id: `v${rows.length + 1}`, attempts: 0, createdAt: new Date(), verifiedAt: null, consumedAt: null, ...data }; rows.push(r); return r; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => (where.id ? r.id === where.id : r.phone === where.phone && r.purpose === where.purpose) && (where.consumedAt === null ? r.consumedAt === null : true) && (where.attempts === undefined || r.attempts === where.attempts) && (where.verifiedAt?.not === null ? r.verifiedAt !== null : true));
        hit.forEach((r) => { if (data.attempts?.increment) r.attempts += data.attempts.increment; else Object.assign(r, data); });
        return { count: hit.length };
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const sent: string[] = [];
  const sms = { configured: true, send: jest.fn(async (_p: string, t: string) => { sent.push(t); return { ok: true }; }) };
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'test-secret-test-secret-test-secret!' : 'test') };
  const svc = new OtpService(prisma, new JwtService({ secret: 'x' }), config as any, sms as any);
  const PHONE = '+923001234567';
  const lastCode = () => /(\d{6})/.exec(sent[sent.length - 1])![1];
  /** Make the cooldown pass without waiting. */
  const age = () => rows.forEach((r) => (r.createdAt = new Date(Date.now() - 120_000)));

  beforeEach(() => { rows.length = 0; sent.length = 0; jest.clearAllMocks(); });

  it('sends a 6-digit code and stores only its hash', async () => {
    await svc.issue(PHONE, 'SIGNUP');
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(rows[0].codeHash).not.toContain(lastCode());
    expect(await bcrypt.compare(lastCode(), rows[0].codeHash)).toBe(true);
  });

  it('enforces the 60-second cooldown and the hourly cap', async () => {
    await svc.issue(PHONE, 'SIGNUP');
    await expect(svc.issue(PHONE, 'SIGNUP')).rejects.toMatchObject({ response: { code: 'OTP_COOLDOWN' } });
    age(); await svc.issue(PHONE, 'SIGNUP');
    age(); await svc.issue(PHONE, 'SIGNUP');
    age();
    await expect(svc.issue(PHONE, 'SIGNUP')).rejects.toMatchObject({ response: { code: 'OTP_LIMIT' } });
  });

  it('a new code replaces the old one (the old one stops working)', async () => {
    await svc.issue(PHONE, 'SIGNUP'); const first = lastCode();
    age(); await svc.issue(PHONE, 'SIGNUP');
    if (first !== lastCode()) await expect(svc.verifySignup(PHONE, first)).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    await expect(svc.verifySignup(PHONE, lastCode())).resolves.toHaveProperty('signupToken');
  });

  it('locks the code after too many wrong tries, even if the right one comes next', async () => {
    await svc.issue(PHONE, 'SIGNUP');
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await expect(svc.verifySignup(PHONE, wrong)).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    await expect(svc.verifySignup(PHONE, right)).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
  });

  it('rejects an expired code', async () => {
    await svc.issue(PHONE, 'SIGNUP');
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.verifySignup(PHONE, lastCode())).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
  });

  it('a signup token works once, only for its own phone', async () => {
    await svc.issue(PHONE, 'SIGNUP');
    const { signupToken } = await svc.verifySignup(PHONE, lastCode());
    await expect(svc.redeemSignupToken(signupToken, '+923009999999')).rejects.toMatchObject({ response: { code: 'PHONE_NOT_VERIFIED' } });
    await expect(svc.redeemSignupToken(signupToken, PHONE)).resolves.toBeUndefined();
    await expect(svc.redeemSignupToken(signupToken, PHONE)).rejects.toMatchObject({ response: { code: 'PHONE_NOT_VERIFIED' } });
    await expect(svc.redeemSignupToken(undefined, PHONE)).rejects.toMatchObject({ response: { code: 'PHONE_NOT_VERIFIED' } });
    await expect(svc.redeemSignupToken('garbage', PHONE)).rejects.toMatchObject({ response: { code: 'PHONE_NOT_VERIFIED' } });
  });

  it('deliver=false applies the same limits but sends nothing', async () => {
    await svc.issue(PHONE, 'SIGNUP', undefined, false);
    expect(sms.send).not.toHaveBeenCalled();
    await expect(svc.issue(PHONE, 'SIGNUP', undefined, false)).rejects.toMatchObject({ response: { code: 'OTP_COOLDOWN' } });
  });

  it('refuses in production when no SMS gateway is configured', async () => {
    const prod = new OtpService(prisma, new JwtService({ secret: 'x' }), { get: (k: string) => (k === 'NODE_ENV' ? 'production' : 's') } as any, { configured: false, send: jest.fn() } as any);
    await expect(prod.issue(PHONE, 'SIGNUP')).rejects.toMatchObject({ response: { code: 'SMS_UNAVAILABLE' } });
  });
});
