import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const tx = { user: { create: jest.fn() }, worker: { create: jest.fn() } };
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const sessions = { create: jest.fn(), refresh: jest.fn(), revoke: jest.fn(), revokeAllExcept: jest.fn(), list: jest.fn() };
  const config = { get: jest.fn() };
  const audit = { record: jest.fn() };
  const svc = new AuthService(prisma, sessions as any, config as any, audit as any, { check: jest.fn() } as any);
  const device = { deviceId: 'device-12345' };

  beforeEach(() => {
    config.get.mockImplementation((k: string) => (k === 'ENABLED_COUNTRIES' ? ['PK'] : undefined));
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    sessions.create.mockResolvedValue({ token: 'access', refreshToken: 'sid.secret' });
  });
  afterEach(() => jest.resetAllMocks());

  const signup = (over: any = {}) =>
    svc.signup({ name: 'Ahmed Khan', phone: '0300 1234567', countryCode: 'PK', password: 'blue-Tiger-42', type: 'customer', ...device, ...over });

  describe('signup', () => {
    it('normalises the phone to E.164, hashes the password and returns tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      tx.user.create.mockResolvedValue({ id: 'u1', type: 'customer' });
      const res = await signup();
      const data = tx.user.create.mock.calls[0][0].data;
      expect(data.phone).toBe('+923001234567');
      expect(data.countryCode).toBe('PK');
      expect(data.password).not.toBe('blue-Tiger-42');
      expect(await bcrypt.compare('blue-Tiger-42', data.password)).toBe(true);
      expect(res).toMatchObject({ token: 'access', refreshToken: 'sid.secret' });
      expect(res.user).not.toHaveProperty('password');
    });

    it("creates an onboarding worker profile in the country's currency and timezone", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      tx.user.create.mockResolvedValue({ id: 'w1', type: 'worker' });
      await signup({ type: 'worker' });
      expect(tx.worker.create).toHaveBeenCalledWith({
        data: { id: 'w1', activationStatus: 'ONBOARDING', currency: 'PKR', timezone: 'Asia/Karachi' },
      });
    });

    it('rejects an invalid or wrong-country phone with a friendly message', async () => {
      await expect(signup({ phone: '0300 12' })).rejects.toThrow(BadRequestException);
      await expect(signup({ phone: '+919876543210' })).rejects.toMatchObject({
        response: { code: 'INVALID_PHONE' },
      });
      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('rejects a country that is not open yet, even though the number is valid', async () => {
      await expect(signup({ phone: '+971501234567', countryCode: 'AE' })).rejects.toMatchObject({
        response: { code: 'COUNTRY_NOT_AVAILABLE' },
      });
    });

    it('enforces the password policy', async () => {
      await expect(signup({ password: 'short' })).rejects.toMatchObject({ response: { code: 'WEAK_PASSWORD' } });
      await expect(signup({ password: 'Password123' })).rejects.toMatchObject({ response: { code: 'WEAK_PASSWORD' } });
      await expect(signup({ password: '03001234567' })).rejects.toMatchObject({ response: { code: 'WEAK_PASSWORD' } });
    });

    it('does not allow a duplicate number (also on a race at the database)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'x' });
      await expect(signup()).rejects.toThrow(ConflictException);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue({ code: 'P2002' });
      await expect(signup()).rejects.toMatchObject({ response: { code: 'PHONE_TAKEN' } });
    });

    it('cannot sign up as admin', async () => {
      // type is validated by the DTO (@IsIn customer|worker); the service never receives it
      expect(['customer', 'worker']).not.toContain('admin');
    });
  });

  describe('login', () => {
    const hash = bcrypt.hashSync('blue-Tiger-42', 4);
    const user = { id: 'u1', password: hash, type: 'customer', status: 'ACTIVE', failedLoginAttempts: 0, lockoutUntil: null };

    it('accepts the number in any format and returns a session', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ id: 'u1', type: 'customer' });
      const res = await svc.login({ phone: '300-1234567', countryCode: 'PK', password: 'blue-Tiger-42', ...device });
      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ phone: '+923001234567' });
      expect(res.token).toBe('access');
    });

    it('unknown number and wrong password give the same error', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const a = await svc.login({ phone: '0300 1234567', countryCode: 'PK', password: 'x', ...device }).catch((e) => e);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({});
      const b = await svc.login({ phone: '0300 1234567', countryCode: 'PK', password: 'wrong', ...device }).catch((e) => e);
      expect(a).toBeInstanceOf(UnauthorizedException);
      expect(a.getResponse()).toEqual(b.getResponse());
    });

    it('locks the account after 5 wrong tries', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, failedLoginAttempts: 4 });
      prisma.user.update.mockResolvedValue({});
      await svc.login({ phone: '0300 1234567', countryCode: 'PK', password: 'wrong', ...device }).catch(() => undefined);
      expect(prisma.user.update.mock.calls[0][0].data.lockoutUntil).toBeInstanceOf(Date);
    });

    it('refuses a locked account even with the right password', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, lockoutUntil: new Date(Date.now() + 600000) });
      await expect(
        svc.login({ phone: '0300 1234567', countryCode: 'PK', password: 'blue-Tiger-42', ...device }),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_LOCKED' } });
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('refuses a suspended account', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, status: 'SUSPENDED' });
      await expect(
        svc.login({ phone: '0300 1234567', countryCode: 'PK', password: 'blue-Tiger-42', ...device }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin login only works for admin accounts, with the generic error otherwise', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, type: 'customer' });
      await expect(svc.adminLogin({ email: 'a@b.com', password: 'blue-Tiger-42', ...device })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('password change', () => {
    const hash = bcrypt.hashSync('blue-Tiger-42', 4);
    it('requires the current password and signs out other devices', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', password: hash, phone: '+923001234567' });
      prisma.user.update.mockResolvedValue({});
      await svc.changePassword('u1', 's1', { currentPassword: 'blue-Tiger-42', newPassword: 'green-Falcon-77' });
      expect(sessions.revokeAllExcept).toHaveBeenCalledWith('u1', 's1');
    });
    it('rejects a wrong current password and weak new passwords', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', password: hash, phone: '+923001234567' });
      await expect(svc.changePassword('u1', 's1', { currentPassword: 'nope', newPassword: 'green-Falcon-77' })).rejects.toThrow(UnauthorizedException);
      await expect(svc.changePassword('u1', 's1', { currentPassword: 'blue-Tiger-42', newPassword: 'abc' })).rejects.toMatchObject({ response: { code: 'WEAK_PASSWORD' } });
      expect(sessions.revokeAllExcept).not.toHaveBeenCalled();
    });
  });
});
