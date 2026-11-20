import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

describe('PaymentsService (cash)', () => {
  const tx: any = {
    payment: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    jobEvent: { create: jest.fn() },
    dispute: { create: jest.fn() },
  };
  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    jobRequest: { findUniqueOrThrow: jest.fn() },
    payment: { findUnique: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    jobEvent: { create: jest.fn() },
  };
  const access = { requireAssignedWorker: jest.fn() };
  const events = { emit: jest.fn() };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const ledger = { post: jest.fn(), notifyPaused: jest.fn() };
  const countries = { forWorker: jest.fn() };
  const config = { get: jest.fn(() => 48) };
  const svc = new PaymentsService(prisma, access as any, events as any, notifications as any, realtime as any, ledger as any, countries as any, config as any);
  const pk = { currency: 'PKR', commission: { rateBps: 1200, minMinor: 10_000, maxMinor: 150_000 } };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    access.requireAssignedWorker.mockResolvedValue({ id: 'j1' });
    prisma.jobRequest.findUniqueOrThrow.mockResolvedValue({ status: 'AWAITING_CONFIRMATION', agreedAmount: 250_000, agreedCurrency: 'PKR', customerId: 'c1', title: 'Tap' });
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
    countries.forWorker.mockResolvedValue(pk);
    ledger.post.mockResolvedValue({ duplicate: false, becameBlocked: false });
    notifications.notify.mockResolvedValue(1);
  });

  it('marks the agreed total (never a typed amount), once; the customer is asked to confirm', async () => {
    const p = await svc.markCashReceived('j1', 'w1');
    expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({ jobRequestId: 'j1', method: 'CASH', amount: 250_000, currency: 'PKR', status: 'MARKED_BY_WORKER', markedById: 'w1' });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment.cash_marked', userIds: ['c1'] }));
    prisma.payment.findUnique.mockResolvedValue(p);
    await expect(svc.markCashReceived('j1', 'w1')).resolves.toBe(p);
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });

  it('a racing second mark returns the first payment', async () => {
    prisma.payment.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p1' });
    await expect(svc.markCashReceived('j1', 'w1')).resolves.toEqual({ id: 'p1' });
  });

  it('not before the work is finished', async () => {
    prisma.jobRequest.findUniqueOrThrow.mockResolvedValue({ status: 'IN_PROGRESS', agreedAmount: 1, agreedCurrency: 'PKR' });
    await expect(svc.markCashReceived('j1', 'w1')).rejects.toMatchObject({ response: { code: 'JOB_NOT_FINISHED' } });
  });

  describe('confirm', () => {
    const confirmed = { id: 'p1', jobRequestId: 'j1', amount: 250_000, currency: 'PKR', status: 'CONFIRMED', jobRequest: { id: 'j1', assignedWorkerId: 'w1', title: 'Tap', customerId: 'c1' } };
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue({ id: 'p1', jobRequest: { customerId: 'c1' } });
      tx.payment.findUniqueOrThrow.mockResolvedValue(confirmed);
    });

    it('books 12 % commission once, under the per-job key, and tells the worker', async () => {
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      await svc.confirmPayment('p1', 'c1');
      expect(tx.payment.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'p1', status: 'MARKED_BY_WORKER' } });
      expect(ledger.post).toHaveBeenCalledWith(tx, expect.objectContaining({ workerId: 'w1', type: 'COMMISSION_OWED', amount: 30_000, idempotencyKey: 'commission:j1' }));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment.confirmed', userIds: ['w1'] }));
    });

    it('a second (or racing) confirm is harmless: no second commission', async () => {
      tx.payment.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.confirmPayment('p1', 'c1')).resolves.toMatchObject({ id: 'p1', status: 'CONFIRMED' });
      expect(ledger.post).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('only the job\'s customer can confirm', async () => {
      await expect(svc.confirmPayment('p1', 'someone-else')).rejects.toThrow(NotFoundException);
    });

    it('a disputed payment cannot be confirmed by the customer', async () => {
      tx.payment.updateMany.mockResolvedValue({ count: 0 });
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...confirmed, status: 'DISPUTED' });
      await expect(svc.confirmPayment('p1', 'c1')).rejects.toThrow(ConflictException);
    });

    it('if the commission pushes the worker over the limit, they are told why new work stopped', async () => {
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      ledger.post.mockResolvedValue({ duplicate: false, becameBlocked: true });
      await svc.confirmPayment('p1', 'c1');
      expect(ledger.notifyPaused).toHaveBeenCalledWith('w1', 'p1');
    });
  });

  it('"I didn\'t pay that": disputed, no commission, the worker is told', async () => {
    prisma.payment.findUnique.mockResolvedValue({ id: 'p1', jobRequestId: 'j1', amount: 250_000, jobRequest: { id: 'j1', customerId: 'c1', assignedWorkerId: 'w1', title: 'Tap' } });
    tx.payment.updateMany.mockResolvedValue({ count: 1 });
    tx.dispute.create.mockResolvedValue({ id: 'd1' });
    await expect(svc.disputePayment('p1', 'c1', 'I paid less')).resolves.toMatchObject({ status: 'DISPUTED', disputeId: 'd1' });
    expect(tx.dispute.create.mock.calls[0][0].data).toMatchObject({ category: 'PAYMENT', paymentId: 'p1', amountHeld: 250_000 });
    expect(ledger.post).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment.disputed', userIds: ['w1'] }));
  });
});
