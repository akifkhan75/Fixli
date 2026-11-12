import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentsService, AUTO_CONFIRM_AFTER_MS } from './payments.service';

const H = 3_600_000;

function build() {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    dispute: { create: jest.fn().mockResolvedValue({ id: 'd1' }) },
    ledgerEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }), create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    jobRequest: { findUnique: jest.fn() },
    payment: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'PK', name: 'W' }) },
    worker: { update: jest.fn() },
    ledgerEntry: { findFirst: jest.fn().mockResolvedValue({ currency: 'PKR' }) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const access = { requireAssignedWorker: jest.fn().mockResolvedValue({}) };
  const events = { emit: jest.fn() };
  const audit = { record: jest.fn() };
  const notifications = { notify: jest.fn().mockResolvedValue(1) };
  const svc = new PaymentsService(prisma, access as any, events as any, audit as any, notifications as any);
  return { svc, prisma, tx, access, events, audit, notifications };
}

const finishedJob = { id: 'j1', title: 'Fix tap', customerId: 'c1', status: 'AWAITING_CONFIRMATION', agreedAmount: 100_000, agreedCurrency: 'PKR' };
const marked = (over: any = {}) => ({
  id: 'p1', jobRequestId: 'j1', amount: 100_000, currency: 'PKR', status: 'MARKED_BY_WORKER', idempotencyKey: null, autoConfirmed: false,
  reminderStage: 0, createdAt: new Date(), jobRequest: { customerId: 'c1', assignedWorkerId: 'w1', title: 'Fix tap' }, ...over,
});

describe('PaymentsService.markCashReceived', () => {
  it('records cash with the JOB currency, never a client one', async () => {
    const { svc, prisma } = build();
    prisma.jobRequest.findUnique.mockResolvedValue(finishedJob);
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.payment.create.mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
    const p = await svc.markCashReceived('j1', 'w1', { amount: 100_000 });
    expect(p.currency).toBe('PKR');
    expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({ method: 'CASH', status: 'MARKED_BY_WORKER', amount: 100_000 });
  });

  it('rejects unfinished jobs, missing price and absurd amounts', async () => {
    const { svc, prisma } = build();
    prisma.jobRequest.findUnique.mockResolvedValue({ ...finishedJob, status: 'IN_PROGRESS' });
    await expect(svc.markCashReceived('j1', 'w1', { amount: 1 })).rejects.toMatchObject({ response: { code: 'JOB_NOT_FINISHED' } });
    prisma.jobRequest.findUnique.mockResolvedValue({ ...finishedJob, agreedAmount: null });
    await expect(svc.markCashReceived('j1', 'w1', { amount: 1 })).rejects.toMatchObject({ response: { code: 'NO_AGREED_PRICE' } });
    prisma.jobRequest.findUnique.mockResolvedValue(finishedJob);
    await expect(svc.markCashReceived('j1', 'w1', { amount: 100_000 * 11 })).rejects.toMatchObject({ response: { code: 'AMOUNT_TOO_HIGH' } });
  });

  it('is idempotent: a repeat returns the existing payment without creating another', async () => {
    const { svc, prisma } = build();
    prisma.jobRequest.findUnique.mockResolvedValue(finishedJob);
    prisma.payment.findFirst.mockResolvedValue(marked());
    const p = await svc.markCashReceived('j1', 'w1', { amount: 100_000 });
    expect(p.id).toBe('p1');
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('conflicts when a different amount is sent after one is already recorded', async () => {
    const { svc, prisma } = build();
    prisma.jobRequest.findUnique.mockResolvedValue(finishedJob);
    prisma.payment.findFirst.mockResolvedValue(marked());
    await expect(svc.markCashReceived('j1', 'w1', { amount: 50_000 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('survives a race: unique-index violation returns the winner', async () => {
    const { svc, prisma } = build();
    prisma.jobRequest.findUnique.mockResolvedValue(finishedJob);
    prisma.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(marked());
    prisma.payment.create.mockRejectedValue({ code: 'P2002' });
    const p = await svc.markCashReceived('j1', 'w1', { amount: 100_000 });
    expect(p.id).toBe('p1');
  });
});

describe('PaymentsService.confirmPayment', () => {
  it('only the job\'s customer may confirm', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(marked());
    await expect(svc.confirmPayment('p1', 'someone-else')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes ONE commission entry (12% of PKR 1,000 = 12,000 paisa) with a key that makes repeats safe', async () => {
    const { svc, prisma, tx } = build();
    prisma.payment.findUnique.mockResolvedValue(marked());
    prisma.payment.findUniqueOrThrow.mockResolvedValue(marked({ status: 'CONFIRMED' }));
    await svc.confirmPayment('p1', 'c1');
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1);
    const d = tx.ledgerEntry.create.mock.calls[0][0].data;
    expect(d).toMatchObject({ type: 'COMMISSION_OWED', amount: -12_000, balanceAfter: -12_000, currency: 'PKR', idempotencyKey: 'commission:p1' });
    expect(tx.$queryRaw).toHaveBeenCalled(); // worker row lock taken
  });

  it('balance is the SUM of prior entries minus the new commission', async () => {
    const { svc, prisma, tx } = build();
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -40_000 } });
    prisma.payment.findUnique.mockResolvedValue(marked());
    prisma.payment.findUniqueOrThrow.mockResolvedValue(marked({ status: 'CONFIRMED' }));
    await svc.confirmPayment('p1', 'c1');
    expect(tx.ledgerEntry.create.mock.calls[0][0].data.balanceAfter).toBe(-52_000);
  });

  it('a second confirm is a no-op (already CONFIRMED)', async () => {
    const { svc, prisma, tx } = build();
    prisma.payment.findUnique.mockResolvedValue(marked({ status: 'CONFIRMED' }));
    const p = await svc.confirmPayment('p1', 'c1');
    expect(p.status).toBe('CONFIRMED');
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('losing a concurrent race writes no second entry', async () => {
    const { svc, prisma, tx } = build();
    prisma.payment.findUnique.mockResolvedValue(marked());
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue(marked({ status: 'CONFIRMED' }));
    await svc.confirmPayment('p1', 'c1');
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('rejects confirming a payment that is not waiting', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(marked({ status: 'DISPUTED' }));
    await expect(svc.confirmPayment('p1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('over the HARD limit takes the worker offline and tells them; booked jobs are untouched', async () => {
    const { svc, prisma, tx, notifications } = build();
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -495_000 } }); // owes PKR 4,950
    prisma.payment.findUnique.mockResolvedValue(marked());
    prisma.payment.findUniqueOrThrow.mockResolvedValue(marked({ status: 'CONFIRMED' }));
    await svc.confirmPayment('p1', 'c1'); // +12,000 -> owes 5,070 > 5,000
    expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { isOnline: false } });
    expect(notifications.notify.mock.calls.some((c: any) => c[0].type === 'worker.commission_blocked')).toBe(true);
  });

  it('between soft and hard limit only warns', async () => {
    const { svc, prisma, tx, notifications } = build();
    tx.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -310_000 } });
    prisma.payment.findUnique.mockResolvedValue(marked());
    prisma.payment.findUniqueOrThrow.mockResolvedValue(marked({ status: 'CONFIRMED' }));
    await svc.confirmPayment('p1', 'c1');
    expect(prisma.worker.update).not.toHaveBeenCalled();
    expect(notifications.notify.mock.calls.some((c: any) => c[0].type === 'worker.commission_warning')).toBe(true);
  });
});

describe('PaymentsService.disputePayment', () => {
  it('opens a dispute and charges commission only on the undisputed minimum', async () => {
    const { svc, prisma, tx, events } = build();
    prisma.payment.findUnique.mockResolvedValue(marked({ amount: 150_000 }));
    prisma.payment.findUniqueOrThrow.mockResolvedValue(marked({ status: 'DISPUTED' }));
    await svc.disputePayment('p1', 'c1', 100_000);
    expect(tx.dispute.create.mock.calls[0][0].data).toMatchObject({ amountHeld: 50_000, category: 'PAYMENT_AMOUNT', raisedById: 'c1' });
    expect(tx.ledgerEntry.create.mock.calls[0][0].data).toMatchObject({ amount: -12_000, metadata: expect.objectContaining({ baseAmount: 100_000, disputed: true }) });
    expect(events.emit).toHaveBeenCalledWith('admin.dispute_opened', { disputeId: 'd1', jobId: 'j1' });
  });

  it('refuses a claim that is not lower than the recorded amount', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(marked());
    await expect(svc.disputePayment('p1', 'c1', 100_000)).rejects.toMatchObject({ response: { code: 'CLAIM_NOT_LOWER' } });
  });

  it('is idempotent once disputed and customer-only', async () => {
    const { svc, prisma, tx } = build();
    prisma.payment.findUnique.mockResolvedValue(marked({ status: 'DISPUTED' }));
    await svc.disputePayment('p1', 'c1', 10);
    expect(tx.dispute.create).not.toHaveBeenCalled();
    await expect(svc.disputePayment('p1', 'other', 10)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PaymentsService.sweepCash', () => {
  it('auto-confirms after 24h with the system flag and tells the customer', async () => {
    const { svc, prisma, tx, notifications } = build();
    const old = marked({ createdAt: new Date(Date.now() - AUTO_CONFIRM_AFTER_MS - 1000) });
    prisma.payment.findMany.mockResolvedValue([old]);
    prisma.payment.findUnique.mockResolvedValue(old);
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ ...old, status: 'CONFIRMED', autoConfirmed: true });
    const r = await svc.sweepCash();
    expect(r.autoConfirmed).toBe(1);
    expect(tx.ledgerEntry.create.mock.calls[0][0].data.metadata).toMatchObject({ autoConfirmed: true, reason: 'CUSTOMER_TIMEOUT' });
    expect(notifications.notify.mock.calls.some((c: any) => c[0].type === 'payment.auto_confirmed')).toBe(true);
  });

  it('sends the latest due reminder once (+2h / +12h / +23h)', async () => {
    const { svc, prisma, notifications } = build();
    prisma.payment.findMany.mockResolvedValue([marked({ createdAt: new Date(Date.now() - 13 * H) })]);
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    const r = await svc.sweepCash();
    expect(r.reminded).toBe(1);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', reminderStage: 0 }, data: { reminderStage: 2 } });
    expect(notifications.notify.mock.calls[0][0].eventKey).toBe('payment.confirm_reminder:p1:2');
  });

  it('does nothing for fresh payments or reminders already sent', async () => {
    const { svc, prisma, notifications } = build();
    prisma.payment.findMany.mockResolvedValue([marked({ createdAt: new Date(Date.now() - 1 * H) }), marked({ id: 'p2', reminderStage: 2, createdAt: new Date(Date.now() - 13 * H) })]);
    const r = await svc.sweepCash();
    expect(r).toEqual({ reminded: 0, autoConfirmed: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('another instance claiming the reminder first prevents a duplicate', async () => {
    const { svc, prisma, notifications } = build();
    prisma.payment.findMany.mockResolvedValue([marked({ createdAt: new Date(Date.now() - 3 * H) })]);
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    expect((await svc.sweepCash()).reminded).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
