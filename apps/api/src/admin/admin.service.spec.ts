import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService, maskEmail, maskPhone } from './admin.service';

describe('masking', () => {
  it('phones keep the first 3 and last 3 digits', () => {
    expect(maskPhone('+92 300 1234567')).toBe('+92•••••••567');
    expect(maskPhone('12345')).toBe('•••');
    expect(maskPhone(null)).toBeNull();
  });
  it('emails keep the first letter and the domain', () => {
    expect(maskEmail('ali@example.com')).toBe('a•••@example.com');
    expect(maskEmail(undefined)).toBeNull();
  });
});

describe('AdminService', () => {
  const prisma: any = {
    user: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    jobRequest: { findMany: jest.fn() }, auditLog: { findMany: jest.fn() }, incident: { findMany: jest.fn() }, payment: { findMany: jest.fn() },
    serviceCategory: { findMany: jest.fn() }, countryConfig: { findMany: jest.fn() }, review: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const sessions = { revokeAllExcept: jest.fn() };
  const svc = new AdminService(prisma, audit as any, sessions as any);
  beforeEach(() => jest.resetAllMocks());

  it('search needs two characters, matches phones by their last digits, and masks unless allowed', async () => {
    expect(await svc.searchUsers('a', false)).toEqual([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u', phone: '+923001234567', email: 'ali@x.com' }]);
    const masked = await svc.searchUsers('0300 123 4567', false);
    expect(masked[0].phone).toContain('•');
    expect(prisma.user.findMany.mock.calls[0][0].where.OR.some((c: any) => c.phone)).toBe(true);
    const full = await svc.searchUsers('ali', true);
    expect(full[0].phone).toBe('+923001234567');
  });

  it('opening a user is audited; unknown user is 404', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u' });
    await svc.userDetail('u', 'a');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.contact_viewed' }));
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.userDetail('x', 'a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('suspend: signs them out everywhere, audits, refuses self and unknown', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u', status: 'ACTIVE', type: 'customer' });
    await expect(svc.suspendUser('a', 'a', 'x')).rejects.toBeInstanceOf(BadRequestException);
    expect(await svc.suspendUser('u', 'a', 'abuse')).toEqual({ id: 'u', status: 'SUSPENDED' });
    expect(sessions.revokeAllExcept).toHaveBeenCalledWith('u');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.suspended' }));
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.suspendUser('x', 'a', 'r')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('job list hides location and masks phones unless allowed', async () => {
    const job = { id: 'j', location: 'home', latitude: 1, longitude: 2, customer: { name: 'C', phone: '+923001234567' }, assignedWorker: { user: { name: 'W', phone: '+923007654321' } } };
    prisma.jobRequest.findMany.mockResolvedValue([job, { id: 'k', customer: null, assignedWorker: null }]);
    const masked: any[] = await svc.getJobsList('CREATED', 0, 10, false);
    expect(masked[0]).toMatchObject({ location: null, latitude: null });
    expect(masked[0].customer.phone).toContain('•');
    expect(masked[0].assignedWorker.user.phone).toContain('•');
    expect(masked[1].customer).toBeNull();
    expect(prisma.jobRequest.findMany.mock.calls[0][0].where).toEqual({ status: 'CREATED' });
    const full: any[] = await svc.getJobsList(undefined, 0, 10, true);
    expect(full[0].location).toBe('home');
  });

  it('plain lists delegate', async () => {
    await svc.getAuditLogs(); await svc.getIncidents('OPEN'); await svc.getIncidents(); await svc.getPayments(); await svc.getCatalog();
    await svc.getCountryConfigs(); await svc.getReportedReviews(); await svc.listStaff();
    expect(prisma.incident.findMany.mock.calls[0][0].where).toEqual({ status: 'OPEN' });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ type: 'admin' });
  });

  describe('staff', () => {
    it('roles: de-duplicated; cannot demote yourself; others are signed out to re-authorise', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u', adminRoles: ['Support'] });
      expect(await svc.setRoles('u', 'a', ['Finance', 'Finance'] as any)).toEqual({ id: 'u', roles: ['Finance'] });
      expect(sessions.revokeAllExcept).toHaveBeenCalledWith('u');
      await expect(svc.setRoles('a', 'a', ['Support'] as any)).rejects.toBeInstanceOf(ForbiddenException);
      sessions.revokeAllExcept.mockClear();
      await svc.setRoles('a', 'a', ['Super Admin'] as any);
      expect(sessions.revokeAllExcept).not.toHaveBeenCalled();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(svc.setRoles('x', 'a', [] as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('2FA reset wipes the secret and codes, signs them out, audits', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u' });
      expect(await svc.resetTwoFactor('u', 'a', 'lost phone')).toEqual({ id: 'u', twoFactor: 'reset' });
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ totpSecret: null, totpEnabledAt: null, totpRecoveryHashes: [] });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.2fa_reset' }));
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(svc.resetTwoFactor('x', 'a', 'r')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
