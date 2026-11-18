import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminVerificationService } from './admin-verification.service';

jest.mock('../common/crypto/field-crypto', () => ({
  maskIdNumber: (v: string | null) => (v ? 'MASKED' : null),
  decryptField: (v: string) => `plain:${v}`,
}));

describe('AdminVerificationService', () => {
  const prisma: any = {
    verificationCase: { findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    worker: { findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
    user: { groupBy: jest.fn() },
    jobRequest: { groupBy: jest.fn() },
    dispute: { count: jest.fn() },
  };
  const notifications = { notify: jest.fn() };
  const storage = { signedUrlForKey: jest.fn(async (k: string) => `https://signed/${k}`) };
  const audit = { record: jest.fn() };
  const svc = new AdminVerificationService(notifications as any, prisma, storage as any, audit as any);

  beforeEach(() => {
    jest.resetAllMocks();
    storage.signedUrlForKey.mockImplementation(async (k: string) => `https://signed/${k}`);
  });

  it('list: oldest first, never returns the raw ID number, pages with a cursor', async () => {
    const row = (id: string) => ({ id, type: 'ID', status: 'SUBMITTED', createdAt: new Date(), reference: 'v1:secret', worker: {} });
    prisma.verificationCase.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);
    const r = await svc.list({ limit: 2 } as any);
    expect(r.items.map((i: any) => i.id)).toEqual(['a', 'b']);
    expect(r.nextCursor).toBe('b');
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r.items[0]).toMatchObject({ referenceMasked: 'MASKED' });
    expect(prisma.verificationCase.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'SUBMITTED' }, take: 3 });
    await svc.list({ cursor: 'b', status: 'APPROVED' } as any);
    expect(prisma.verificationCase.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'b' }, skip: 1, where: { status: 'APPROVED' } });
  });

  describe('detail', () => {
    it('404 for an unknown case', async () => {
      prisma.verificationCase.findUnique.mockResolvedValue(null);
      await expect(svc.detail('x', 'adm')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('signs 5-minute links, hides keys and the number, and audits the view', async () => {
      prisma.verificationCase.findUnique.mockResolvedValue({ id: 'c1', documentKeys: ['k1', 'k2'], reference: 'v1:secret', status: 'SUBMITTED' });
      const r = await svc.detail('c1', 'adm');
      expect(storage.signedUrlForKey).toHaveBeenCalledWith('k1', 300);
      expect(r.documents).toEqual([{ url: 'https://signed/k1' }, { url: 'https://signed/k2' }]);
      expect(r).not.toHaveProperty('documentKeys');
      expect(r).not.toHaveProperty('reference');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.documents_viewed', actorId: 'adm' }));
    });
  });

  describe('revealReference', () => {
    it('404 when the case or number is missing', async () => {
      prisma.verificationCase.findUnique.mockResolvedValue(null);
      await expect(svc.revealReference('x', 'adm')).rejects.toBeInstanceOf(NotFoundException);
      prisma.verificationCase.findUnique.mockResolvedValue({ reference: null });
      await expect(svc.revealReference('x', 'adm')).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();
    });
    it('decrypts and always audits', async () => {
      prisma.verificationCase.findUnique.mockResolvedValue({ reference: 'enc', workerId: 'w1', type: 'ID' });
      await expect(svc.revealReference('c1', 'adm')).resolves.toEqual({ id: 'c1', reference: 'plain:enc' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.reference_revealed', actorId: 'adm' }));
    });
  });

  describe('decide', () => {
    it('a rejection or request for info needs a reason', async () => {
      await expect(svc.decide('c1', 'adm', { decision: 'REJECT' } as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.decide('c1', 'adm', { decision: 'NEEDS_INFO', reason: '   ' } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.verificationCase.updateMany).not.toHaveBeenCalled();
    });
    it('404 for an unknown case, 409 for one already decided', async () => {
      prisma.verificationCase.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationCase.findUnique.mockResolvedValueOnce(null);
      await expect(svc.decide('c1', 'adm', { decision: 'APPROVE' } as any)).rejects.toBeInstanceOf(NotFoundException);
      prisma.verificationCase.findUnique.mockResolvedValueOnce({ id: 'c1' });
      await expect(svc.decide('c1', 'adm', { decision: 'APPROVE' } as any)).rejects.toBeInstanceOf(ConflictException);
    });
    const setup = (decision: string, others: any[], activation = 'PENDING_REVIEW') => {
      prisma.verificationCase.updateMany.mockResolvedValue({ count: 1 });
      prisma.verificationCase.findUniqueOrThrow.mockResolvedValue({ workerId: 'w1', type: 'ID' });
      prisma.worker.findUnique.mockResolvedValue({ activationStatus: activation });
      prisma.verificationCase.findMany.mockResolvedValue(others);
      return svc.decide('c1', 'adm', { decision, reason: 'blurry' } as any);
    };
    it('approving the last missing document activates and verifies the worker', async () => {
      const r = await setup('APPROVE', [{ type: 'ID', status: 'APPROVED' }, { type: 'SELFIE', status: 'APPROVED' }]);
      expect(r).toEqual({ id: 'c1', status: 'APPROVED' });
      expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { activationStatus: 'ACTIVE', isVerified: true } });
      expect(notifications.notify.mock.calls.map((c: any) => c[0].type)).toEqual(['verification.approved', 'worker.activated']);
    });
    it('approving one of two leaves the worker pending', async () => {
      await setup('APPROVE', [{ type: 'ID', status: 'APPROVED' }, { type: 'SELFIE', status: 'SUBMITTED' }]);
      expect(prisma.worker.update).not.toHaveBeenCalled();
    });
    it('rejecting sends a pending worker back to fix it and tells them why', async () => {
      await setup('REJECT', [{ type: 'ID', status: 'REJECTED' }, { type: 'SELFIE', status: 'APPROVED' }]);
      expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { activationStatus: 'ONBOARDING' } });
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'verification.needs_fix', params: { reason: 'blurry' } });
    });
    it('does not touch a worker who is not waiting for review', async () => {
      await setup('REJECT', [], 'ACTIVE');
      expect(prisma.worker.update).not.toHaveBeenCalled();
    });
  });

  it('stats: counts by type/status plus open disputes and the review queue', async () => {
    prisma.user.groupBy.mockResolvedValue([{ type: 'customer', _count: 3 }]);
    prisma.worker.groupBy.mockResolvedValue([{ activationStatus: 'ACTIVE', _count: 2 }]);
    prisma.jobRequest.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: 5 }]);
    prisma.dispute.count.mockResolvedValue(1); prisma.verificationCase.count.mockResolvedValue(4);
    await expect(svc.stats()).resolves.toEqual({ users: { customer: 3 }, workers: { ACTIVE: 2 }, jobs: { COMPLETED: 5 }, openDisputes: 1, pendingVerifications: 4 });
  });
});
