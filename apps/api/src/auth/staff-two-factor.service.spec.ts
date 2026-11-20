import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StaffTwoFactorService } from './staff-two-factor.service';
import { SecretBox } from '../common/auth/secret-box';
import { generateSecret, hashRecoveryCode, totp } from '../common/auth/totp';

describe('StaffTwoFactorService', () => {
  const box = new SecretBox(Buffer.alloc(32, 5).toString('base64'), 'jwt-secret-for-tests');
  const jwt = new JwtService({ secret: 'jwt-secret-for-tests' });
  const prisma: any = { user: { findUniqueOrThrow: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() } };
  const audit = { record: jest.fn() };
  const make = (totpRequired = true) => new StaffTwoFactorService(prisma, jwt, audit as any, { totpRequired, box });
  const secret = generateSecret();
  const enrolled = (over: any = {}) => ({ totpSecret: box.seal(secret), totpEnabledAt: new Date(), totpRecoveryHashes: [], failedLoginAttempts: 0, totpLastStep: null, ...over });
  beforeEach(() => jest.resetAllMocks());

  describe('check (sign-in)', () => {
    it('no authenticator yet: setup is demanded with a short-lived setup token (or skipped when not required)', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ totpSecret: null, totpEnabledAt: null });
      await expect(make().check('u')).rejects.toMatchObject({ response: { code: 'TOTP_SETUP_REQUIRED', details: { setupToken: expect.any(String) } } });
      await expect(make(false).check('u')).resolves.toBeUndefined();
    });

    it('enrolled but no code: asks for one', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
      await expect(make().check('u', '  ')).rejects.toMatchObject({ response: { code: 'TOTP_REQUIRED' } });
    });

    it('a correct code works once; replaying it is refused', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
      prisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(make().check('u', totp(secret))).resolves.toBeUndefined();
      prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(make().check('u', totp(secret))).rejects.toMatchObject({ response: { code: 'CODE_ALREADY_USED' } });
    });

    it('a recovery code works once and is audited; a lost race on it fails like a wrong code', async () => {
      const code = 'abcd-efgh';
      prisma.user.findUniqueOrThrow.mockResolvedValue(enrolled({ totpRecoveryHashes: [hashRecoveryCode(code), 'other'] }));
      prisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(make().check('u', code)).resolves.toBeUndefined();
      expect(prisma.user.updateMany.mock.calls[0][0].data.totpRecoveryHashes).toEqual(['other']);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.recovery_code_used', after: { left: 1 } }));
      prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(make().check('u', code)).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    });

    it('wrong codes are counted and the fifth locks the account for 15 minutes', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(enrolled({ failedLoginAttempts: 1 }));
      await expect(make().check('u', '000000')).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ failedLoginAttempts: 2, lockoutUntil: null });
      prisma.user.findUniqueOrThrow.mockResolvedValue(enrolled({ failedLoginAttempts: 4 }));
      await expect(make().check('u', 'garbage')).rejects.toBeInstanceOf(UnauthorizedException);
      const lock = prisma.user.update.mock.calls[1][0].data.lockoutUntil as Date;
      expect(lock.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    });
  });

  describe('setup', () => {
    const setupToken = (over: any = {}) => jwt.sign({ sub: 'u', purpose: 'staff-totp-setup', ...over }, { expiresIn: '10m' });
    const staff = (over: any = {}) => ({ id: 'u', email: 'a@x.com', totpSecret: null, totpEnabledAt: null, ...over });

    it('rejects a bad, wrong-purpose or unknown-user token', async () => {
      await expect(make().begin('not-a-jwt')).rejects.toMatchObject({ response: { code: 'SETUP_EXPIRED' } });
      await expect(make().begin(setupToken({ purpose: 'login' }))).rejects.toMatchObject({ response: { code: 'SETUP_EXPIRED' } });
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(make().begin(setupToken())).rejects.toMatchObject({ response: { code: 'SETUP_EXPIRED' } });
    });

    it('refuses to re-enrol over an existing authenticator', async () => {
      prisma.user.findFirst.mockResolvedValue(staff({ totpEnabledAt: new Date() }));
      await expect(make().begin(setupToken())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('begin stores the secret sealed and returns it once with the QR link', async () => {
      prisma.user.findFirst.mockResolvedValue(staff());
      const out = await make().begin(setupToken());
      const stored = prisma.user.update.mock.calls[0][0].data.totpSecret as string;
      expect(stored).not.toContain(out.secret);
      expect(box.open(stored)).toBe(out.secret);
      expect(out.otpauthUrl).toContain('otpauth://totp/');
    });

    it('activate: wrong code is refused; right code enables, shows recovery codes once and audits', async () => {
      prisma.user.findFirst.mockResolvedValue(staff({ totpSecret: box.seal(secret) }));
      await expect(make().activate(setupToken(), '000000')).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      const out = await make().activate(setupToken(), totp(secret));
      expect(out.userId).toBe('u');
      expect(out.recoveryCodes.length).toBe(10);
      expect(prisma.user.updateMany.mock.calls[0][0].data.totpRecoveryHashes).toHaveLength(10);
      expect(prisma.user.updateMany.mock.calls[0][0].data.totpRecoveryHashes).not.toContain(out.recoveryCodes[0]);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.2fa_enabled' }));
    });

    it('activate without a begun secret fails; a concurrent activation loses', async () => {
      prisma.user.findFirst.mockResolvedValue(staff());
      await expect(make().activate(setupToken(), totp(secret))).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
      prisma.user.findFirst.mockResolvedValue(staff({ totpSecret: box.seal(secret) }));
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(make().activate(setupToken(), totp(secret))).rejects.toMatchObject({ response: { code: 'TOTP_ALREADY_SET' } });
    });
  });
});
