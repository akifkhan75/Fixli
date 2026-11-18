import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const prisma: any = {
    user: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    jobRequest: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    auditLog: { findMany: jest.fn() }, incident: { findMany: jest.fn() }, payment: { findMany: jest.fn() },
    serviceCategory: { findMany: jest.fn() }, countryConfig: { findMany: jest.fn() }, review: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const svc = new AdminService(prisma, audit as any);
  beforeEach(() => jest.resetAllMocks());

  it('searches name, phone and email, capped at 50 and without passwords', async () => {
    await svc.searchUsers('ali');
    const a = prisma.user.findMany.mock.calls[0][0];
    expect(a.where.OR).toHaveLength(3);
    expect(a.take).toBe(50);
    expect(a.select).not.toHaveProperty('password');
  });

  describe('suspendUser', () => {
    it('404 for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.suspendUser('u', 'adm', 'spam')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
    it('suspends and writes the reason to the audit log', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u' }); prisma.user.update.mockResolvedValue({ id: 'u', status: 'SUSPENDED' });
      await svc.suspendUser('u', 'adm', 'spam');
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u' }, data: { status: 'SUSPENDED' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'adm', action: 'user.suspended', after: { status: 'SUSPENDED', reason: 'spam' } }));
    });
  });

  describe('cancelJob', () => {
    it('404 for an unknown job', async () => {
      prisma.jobRequest.findUnique.mockResolvedValue(null);
      await expect(svc.cancelJob('j', 'adm', 'r')).rejects.toBeInstanceOf(NotFoundException);
    });
    it.each(['COMPLETED', 'CANCELLED'])('refuses to rewrite a %s job', async (status) => {
      prisma.jobRequest.findUnique.mockResolvedValue({ status });
      await expect(svc.cancelJob('j', 'adm', 'r')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.jobRequest.update).not.toHaveBeenCalled();
    });
    it('cancels an open job and audits it', async () => {
      prisma.jobRequest.findUnique.mockResolvedValue({ status: 'IN_PROGRESS' }); prisma.jobRequest.update.mockResolvedValue({ id: 'j', status: 'CANCELLED' });
      await svc.cancelJob('j', 'adm', 'fraud');
      expect(prisma.jobRequest.update).toHaveBeenCalledWith({ where: { id: 'j' }, data: { status: 'CANCELLED' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'job.cancelled', after: { status: 'CANCELLED', reason: 'fraud' } }));
    });
  });

  it('lists with filters and paging defaults', async () => {
    await svc.getJobsList('COMPLETED', 5, 10);
    expect(prisma.jobRequest.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'COMPLETED' }, skip: 5, take: 10 });
    await svc.getJobsList();
    expect(prisma.jobRequest.findMany.mock.calls[1][0]).toMatchObject({ where: {}, skip: 0, take: 50 });
    await svc.getAuditLogs(); await svc.getIncidents('OPEN'); await svc.getIncidents(); await svc.getPayments();
    await svc.getCatalog(); await svc.getCountryConfigs(); await svc.getReportedReviews();
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(100);
    expect(prisma.incident.findMany.mock.calls[0][0].where).toEqual({ status: 'OPEN' });
    expect(prisma.incident.findMany.mock.calls[1][0].where).toEqual({});
    expect(prisma.review.findMany.mock.calls[0][0].where).toEqual({ rating: 1 });
  });
});
