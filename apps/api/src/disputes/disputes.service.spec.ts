import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DisputesService } from './disputes.service';

describe('DisputesService', () => {
  const tx: any = { dispute: { create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() }, jobRequest: { findUniqueOrThrow: jest.fn() } };
  const prisma: any = {
    jobRequest: { findUniqueOrThrow: jest.fn() },
    dispute: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    conversation: { updateMany: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const access = { requireParticipant: jest.fn() };
  const audit = { record: jest.fn() };
  const events = { emit: jest.fn() };
  const staff = { assert: jest.fn() };
  const storage = { consume: jest.fn(), signedUrlForKey: jest.fn(async (k: string) => `https://x/${k}`) };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const ledger = { post: jest.fn() };
  const payments = { settleDisputed: jest.fn() };
  const milestones = { resolveDispute: jest.fn() };
  const svc = new DisputesService(prisma, access as any, audit as any, events as any, staff as any, storage as any, notifications as any, realtime as any, ledger as any, payments as any, milestones as any);
  const cust = { id: 'c1', type: 'customer' };
  const job = { id: 'j1', customerId: 'c1', assignedWorkerId: 'w1' };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    storage.signedUrlForKey.mockImplementation(async (k: string) => `https://x/${k}`);
    access.requireParticipant.mockResolvedValue(job);
    prisma.jobRequest.findUniqueOrThrow.mockResolvedValue({ agreedAmount: 100000, title: 'Fix tap' });
    prisma.dispute.count.mockResolvedValue(0);
  });

  describe('createDispute', () => {
    const created = { id: 'd1', jobRequestId: 'j1', evidenceKeys: ['k1'], status: 'OPEN' };

    it('rejects an amount above the job price', async () => {
      await expect(svc.createDispute(cust, { jobRequestId: 'j1', reason: 'x', amountHeld: 200000 } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a second open dispute on the same job', async () => {
      prisma.dispute.count.mockResolvedValue(1);
      await expect(svc.createDispute(cust, { jobRequestId: 'j1', reason: 'x' } as any)).rejects.toBeInstanceOf(ConflictException);
    });

    it('stores it with consumed evidence, audits, reopens chat, tells the other side and hides keys', async () => {
      storage.consume.mockResolvedValue(['k1']);
      tx.dispute.create.mockResolvedValue(created);
      const out = await svc.createDispute(cust, { jobRequestId: 'j1', reason: 'bad', evidenceUploadIds: ['u1'] } as any);
      expect(storage.consume).toHaveBeenCalledWith('c1', ['u1'], 'JOB_PHOTO', tx);
      expect(tx.dispute.create.mock.calls[0][0].data).toMatchObject({ category: 'OTHER', raisedById: 'c1', evidenceKeys: ['k1'] });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'dispute.opened' }));
      expect(events.emit).toHaveBeenCalledWith('admin.dispute_opened', { disputeId: 'd1', jobId: 'j1' });
      expect(prisma.conversation.updateMany).toHaveBeenCalled();
      expect(notifications.notify.mock.calls[0][0].userIds).toEqual(['w1']);
      expect(out).toMatchObject({ id: 'd1', evidenceCount: 1 });
      expect(out).not.toHaveProperty('evidenceKeys');
    });

    it('tells the customer when the worker raises it, and nobody when there is no other party', async () => {
      tx.dispute.create.mockResolvedValue({ ...created, evidenceKeys: [] });
      await svc.createDispute({ id: 'w1', type: 'worker' }, { jobRequestId: 'j1', reason: 'rude' } as any);
      expect(notifications.notify.mock.calls[0][0].userIds).toEqual(['c1']);
      notifications.notify.mockClear();
      access.requireParticipant.mockResolvedValue({ ...job, assignedWorkerId: null });
      await svc.createDispute(cust, { jobRequestId: 'j1', reason: 'x' } as any);
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('a participant gets signed evidence links, a stranger gets 404', async () => {
      prisma.dispute.findFirst.mockResolvedValueOnce({ id: 'd1', evidenceKeys: ['a', 'b'] });
      const d = await svc.getDisputeById('d1', cust);
      expect(d.evidence).toEqual(['https://x/a', 'https://x/b']);
      expect(prisma.dispute.findFirst.mock.calls[0][0].where.OR).toBeDefined();
      prisma.dispute.findFirst.mockResolvedValueOnce(null);
      await expect(svc.getDisputeById('nope', cust)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('staff are not limited to their own disputes', async () => {
      prisma.dispute.findFirst.mockResolvedValue({ id: 'd1', evidenceKeys: [] });
      await svc.getDisputeById('d1', { id: 'a1', type: 'admin' });
      expect(prisma.dispute.findFirst.mock.calls[0][0].where.OR).toBeUndefined();
    });

    it('lists never carry storage keys', async () => {
      prisma.dispute.findMany.mockResolvedValue([{ id: 'd1', evidenceKeys: ['a'] }]);
      expect(await svc.getUserDisputes('c1')).toEqual([{ id: 'd1', evidenceCount: 1 }]);
      expect(await svc.getAllDisputes()).toEqual([{ id: 'd1', evidenceCount: 1 }]);
    });
  });

  describe('updateDisputeStatus', () => {
    const before = { id: 'd1', status: 'OPEN', paymentId: 'p1', jobRequestId: 'j1', resolution: null, jobRequest: { id: 'j1', title: 'Fix tap', customerId: 'c1', assignedWorkerId: 'w1' } };
    const after = { id: 'd1', status: 'RESOLVED', resolution: 'ok', evidenceKeys: [] };
    beforeEach(() => {
      prisma.dispute.findUnique.mockResolvedValue(before);
      tx.dispute.updateMany.mockResolvedValue({ count: 1 });
      tx.dispute.findUniqueOrThrow.mockResolvedValue(after);
      tx.jobRequest.findUniqueOrThrow.mockResolvedValue({ agreedCurrency: 'PKR', currency: 'PKR' });
    });

    it('404 for an unknown dispute; 409 when already closed', async () => {
      prisma.dispute.findUnique.mockResolvedValueOnce(null);
      await expect(svc.updateDisputeStatus('x', { status: 'RESOLVED' } as any, 'a1')).rejects.toBeInstanceOf(NotFoundException);
      prisma.dispute.findUnique.mockResolvedValueOnce({ ...before, status: 'CLOSED' });
      await expect(svc.updateDisputeStatus('d1', { status: 'RESOLVED' } as any, 'a1')).rejects.toMatchObject({ response: { code: 'DISPUTE_CLOSED' } });
    });

    it('a payment outcome needs a payment dispute and a closing status', async () => {
      prisma.dispute.findUnique.mockResolvedValueOnce({ ...before, paymentId: null });
      await expect(svc.updateDisputeStatus('d1', { status: 'RESOLVED', paymentOutcome: 'VOID' } as any, 'a1')).rejects.toMatchObject({ response: { code: 'NOT_A_PAYMENT_DISPUTE' } });
      await expect(svc.updateDisputeStatus('d1', { status: 'IN_REVIEW', paymentOutcome: 'VOID' } as any, 'a1')).rejects.toMatchObject({ response: { code: 'RESOLVE_TO_APPLY' } });
    });

    it('409 when someone else changed it first', async () => {
      tx.dispute.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.updateDisputeStatus('d1', { status: 'RESOLVED' } as any, 'a1')).rejects.toMatchObject({ response: { code: 'DISPUTE_CHANGED' } });
    });

    it('resolves: books the adjustment (needs finance.adjust), settles the payment once, audits, tells both sides', async () => {
      const out = await svc.updateDisputeStatus('d1', { status: 'RESOLVED', resolution: 'ok', paymentOutcome: 'CONFIRM', ledgerAdjustment: { amount: -500, note: 'goodwill' } } as any, 'a1');
      expect(staff.assert).toHaveBeenCalledWith({ id: 'a1', type: 'admin' }, 'finance.adjust');
      expect(ledger.post).toHaveBeenCalledWith(tx, expect.objectContaining({ workerId: 'w1', type: 'ADJUSTMENT', amount: -500, currency: 'PKR', idempotencyKey: 'dispute:d1:adjustment' }));
      expect(payments.settleDisputed).toHaveBeenCalledWith('p1', 'a1', 'CONFIRM');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'dispute.updated' }));
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1', 'w1'], 'job.updated', { jobId: 'j1' });
      expect(out).toMatchObject({ id: 'd1', evidenceCount: 0 });
    });

    it('a plain status change does not touch money', async () => {
      await svc.updateDisputeStatus('d1', { status: 'IN_REVIEW' } as any, 'a1');
      expect(ledger.post).not.toHaveBeenCalled();
      expect(payments.settleDisputed).not.toHaveBeenCalled();
      expect(tx.dispute.updateMany.mock.calls[0][0].data.resolvedById).toBeUndefined();
    });
  });
});
