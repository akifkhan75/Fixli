import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminVerificationService } from './admin-verification.service';
import { encryptField } from '../common/crypto/field-crypto';

describe('AdminVerificationService', () => {
  const prisma: any = {
    verificationCase: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
    worker: { findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
    user: { groupBy: jest.fn() }, jobRequest: { groupBy: jest.fn() }, dispute: { count: jest.fn() },
  };
  const notifications = { notify: jest.fn() };
  const storage = { signedUrlForKey: jest.fn(async (k: string) => `https://x/${k}`) };
  const audit = { record: jest.fn() };
  const svc = new AdminVerificationService(notifications as any, prisma, storage as any, audit as any);
  beforeEach(() => { jest.resetAllMocks(); storage.signedUrlForKey.mockImplementation(async (k: string) => `https://x/${k}`); });

  describe('list', () => {
    it('shows the ID number masked, pages by cursor, oldest first', async () => {
      const row = (id: string) => ({ id, type: 'ID', reference: '42101-1234567-1', worker: {} });
      prisma.verificationCase.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);
      const out = await svc.list({ limit: 2, cursor: 'z' } as any);
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).toBe('b');
      expect(JSON.stringify(out)).not.toContain('1234567');
      expect(out.items[0]).toHaveProperty('referenceMasked');
      expect(prisma.verificationCase.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: 'z' }, skip: 1, where: { status: 'SUBMITTED' } });
    });
    it('last page has no cursor', async () => {
      prisma.verificationCase.findMany.mockResolvedValue([]);
      expect((await svc.list({ status: 'APPROVED' } as any)).nextCursor).toBeNull();
    });
  });

  describe('detail and reveal', () => {
    it('detail signs short links, audits the view and hides keys and the full number', async () => {
      prisma.verificationCase.findUnique.mockResolvedValue({ id: 'c', documentKeys: ['k1', 'k2'], reference: null });
      const d: any = await svc.detail('c', 'a1');
      expect(d.documents).toEqual([{ url: 'https://x/k1' }, { url: 'https://x/k2' }]);
      expect(d).not.toHaveProperty('documentKeys');
      expect(d).not.toHaveProperty('reference');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.documents_viewed' }));
      prisma.verificationCase.findUnique.mockResolvedValue(null);
      await expect(svc.detail('x', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reveal decrypts and audits; missing case or number is 404', async () => {
      prisma.verificationCase.findUnique.mockResolvedValue({ reference: encryptField('42101-1234567-1'), workerId: 'w', type: 'ID' });
      expect(await svc.revealReference('c', 'a1')).toEqual({ id: 'c', reference: '42101-1234567-1' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'verification.reference_revealed' }));
      prisma.verificationCase.findUnique.mockResolvedValue({ reference: null });
      await expect(svc.revealReference('c', 'a1')).rejects.toBeInstanceOf(NotFoundException);
      prisma.verificationCase.findUnique.mockResolvedValue(null);
      await expect(svc.revealReference('c', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('decide', () => {
    it('a reject or needs-info decision must say why', async () => {
      await expect(svc.decide('c', 'a', { decision: 'REJECT' } as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.decide('c', 'a', { decision: 'NEEDS_INFO', reason: '  ' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only an open case can be decided: 404 if missing, 409 if already decided', async () => {
      prisma.verificationCase.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationCase.findUnique.mockResolvedValueOnce(null);
      await expect(svc.decide('c', 'a', { decision: 'APPROVE' } as any)).rejects.toBeInstanceOf(NotFoundException);
      prisma.verificationCase.findUnique.mockResolvedValueOnce({ id: 'c' });
      await expect(svc.decide('c', 'a', { decision: 'APPROVE' } as any)).rejects.toBeInstanceOf(ConflictException);
    });

    const decide = async (decision: string, cases: any[], activation = 'PENDING_REVIEW') => {
      prisma.verificationCase.updateMany.mockResolvedValue({ count: 1 });
      prisma.verificationCase.findUniqueOrThrow.mockResolvedValue({ workerId: 'w', type: 'ID' });
      prisma.worker.findUnique.mockResolvedValue({ activationStatus: activation });
      prisma.verificationCase.findMany.mockResolvedValue(cases);
      return svc.decide('c', 'a', { decision, reason: decision === 'APPROVE' ? undefined : 'blurry' } as any);
    };

    it('approving the last missing document activates the worker and says so', async () => {
      const out = await decide('APPROVE', [{ type: 'ID', status: 'APPROVED' }, { type: 'SELFIE', status: 'APPROVED' }]);
      expect(out).toEqual({ id: 'c', status: 'APPROVED' });
      expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w' }, data: { activationStatus: 'ACTIVE', isVerified: true } });
      expect(notifications.notify.mock.calls.map((c: any) => c[0].type)).toEqual(['verification.approved', 'worker.activated']);
    });

    it('approving one of two leaves the worker waiting', async () => {
      await decide('APPROVE', [{ type: 'ID', status: 'APPROVED' }, { type: 'SELFIE', status: 'SUBMITTED' }]);
      expect(prisma.worker.update).not.toHaveBeenCalled();
    });

    it('a rejection sends a pending worker back to fix it, with the reason', async () => {
      const out = await decide('REJECT', [{ type: 'ID', status: 'REJECTED' }]);
      expect(out.status).toBe('REJECTED');
      expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w' }, data: { activationStatus: 'ONBOARDING' } });
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'verification.needs_fix', params: { reason: 'blurry' } });
    });

    it('an already-active worker keeps their status', async () => {
      await decide('NEEDS_INFO', [{ type: 'ID', status: 'NEEDS_INFO' }], 'ACTIVE');
      expect(prisma.worker.update).not.toHaveBeenCalled();
    });
  });

  it('stats counts by group', async () => {
    prisma.user.groupBy.mockResolvedValue([{ type: 'customer', _count: 3 }]);
    prisma.worker.groupBy.mockResolvedValue([{ activationStatus: 'ACTIVE', _count: 1 }]);
    prisma.jobRequest.groupBy.mockResolvedValue([{ status: 'CREATED', _count: 2 }]);
    prisma.dispute.count.mockResolvedValue(4);
    prisma.verificationCase.count.mockResolvedValue(5);
    expect(await svc.stats()).toEqual({ users: { customer: 3 }, workers: { ACTIVE: 1 }, jobs: { CREATED: 2 }, openDisputes: 4, pendingVerifications: 5 });
  });
});
