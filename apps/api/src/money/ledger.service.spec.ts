import { isBlocked, LedgerService } from './ledger.service';

const limits = { softMinor: 3000, hardMinor: 5000, maxDaysOwed: 7 } as any;

describe('isBlocked', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  it('owing nothing is never blocked', () => expect(isBlocked(0, null, limits, now)).toBe(false));
  it('the hard limit blocks at once', () => expect(isBlocked(5000, null, limits, now)).toBe(true));
  it('below the limit is fine while the debt is recent', () => expect(isBlocked(1000, new Date('2026-11-18T00:00:00Z'), limits, now)).toBe(false));
  it('owing for longer than allowed blocks', () => expect(isBlocked(1000, new Date('2026-11-10T00:00:00Z'), limits, now)).toBe(true));
  it('a debt with no start date is not blocked below the hard limit', () => expect(isBlocked(1000, null, limits, now)).toBe(false));
});

describe('LedgerService', () => {
  const tx: any = { ledgerEntry: { findUnique: jest.fn(), create: jest.fn() }, $queryRaw: jest.fn(), worker: { update: jest.fn() } };
  const prisma: any = { worker: { findMany: jest.fn(), updateMany: jest.fn() } };
  const countries = { forWorker: jest.fn() };
  const notifications = { notify: jest.fn() };
  const svc = new LedgerService(prisma, countries as any, notifications as any);
  const post = { workerId: 'w', type: 'COMMISSION_OWED' as const, amount: 1000, currency: 'PKR', idempotencyKey: 'commission:p1' };

  beforeEach(() => {
    jest.resetAllMocks();
    countries.forWorker.mockResolvedValue({ cashLimits: limits });
    tx.ledgerEntry.findUnique.mockResolvedValue(null);
    tx.ledgerEntry.create.mockImplementation(async ({ data }: any) => ({ id: 'e1', ...data }));
  });

  it('the same event posts once: an existing entry is returned untouched', async () => {
    tx.ledgerEntry.findUnique.mockResolvedValue({ id: 'old' });
    expect(await svc.post(tx, post)).toMatchObject({ duplicate: true, becameBlocked: false, entry: { id: 'old' } });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('a concurrent post that commits during the lock wait counts as a duplicate', async () => {
    tx.ledgerEntry.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced' });
    tx.$queryRaw.mockResolvedValue([{ ledgerBalance: 0, owedSince: null, balanceBlocked: false }]);
    expect(await svc.post(tx, post)).toMatchObject({ duplicate: true, entry: { id: 'raced' } });
    expect(tx.worker.update).not.toHaveBeenCalled();
  });

  it('the first debt starts the clock and records the running balance', async () => {
    tx.$queryRaw.mockResolvedValue([{ ledgerBalance: 0, owedSince: null, balanceBlocked: false }]);
    const r = await svc.post(tx, { ...post, jobRequestId: 'j1', note: 'n', createdById: 'a' });
    const data = tx.worker.update.mock.calls[0][0].data;
    expect(data.ledgerBalance).toBe(1000);
    expect(data.owedSince).toBeInstanceOf(Date);
    expect(data.balanceBlocked).toBe(false);
    expect(r.entry).toMatchObject({ balanceAfter: 1000, jobRequestId: 'j1', createdById: 'a' });
    expect(r.becameBlocked).toBe(false);
  });

  it('more debt keeps the original start date', async () => {
    const since = new Date('2026-11-19T00:00:00Z');
    tx.$queryRaw.mockResolvedValue([{ ledgerBalance: 500, owedSince: since, balanceBlocked: false }]);
    await svc.post(tx, post);
    expect(tx.worker.update.mock.calls[0][0].data.owedSince).toBe(since);
  });

  it('settling in full clears the clock and lifts the pause', async () => {
    tx.$queryRaw.mockResolvedValue([{ ledgerBalance: 1000, owedSince: new Date(), balanceBlocked: true }]);
    const r = await svc.post(tx, { ...post, type: 'COMMISSION_SETTLED', amount: -1000 });
    expect(tx.worker.update.mock.calls[0][0].data).toMatchObject({ ledgerBalance: 0, owedSince: null, balanceBlocked: false });
    expect(r.becameBlocked).toBe(false);
  });

  it('crossing the hard limit pauses the worker and reports that it just happened', async () => {
    tx.$queryRaw.mockResolvedValue([{ ledgerBalance: 4500, owedSince: new Date(), balanceBlocked: false }]);
    const r = await svc.post(tx, post);
    expect(tx.worker.update.mock.calls[0][0].data.balanceBlocked).toBe(true);
    expect(r.becameBlocked).toBe(true);
  });

  it('already paused workers do not trigger a second notice', async () => {
    tx.$queryRaw.mockResolvedValue([{ ledgerBalance: 6000, owedSince: new Date(), balanceBlocked: true }]);
    expect((await svc.post(tx, post)).becameBlocked).toBe(false);
  });

  it('notifyPaused tells the worker once per key', async () => {
    await svc.notifyPaused('w', 'e1');
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'balance.paused', userIds: ['w'], eventKey: 'balance.paused:e1' });
  });

  describe('refreshBlocks', () => {
    it('pauses (and tells) only workers who have owed too long; a lost race is not counted', async () => {
      const old = new Date('2026-01-01T00:00:00Z');
      prisma.worker.findMany.mockResolvedValue([
        { id: 'a', ledgerBalance: 100, owedSince: old },
        { id: 'b', ledgerBalance: 100, owedSince: new Date() },
        { id: 'c', ledgerBalance: 100, owedSince: old },
        { id: 'd', ledgerBalance: 9999, owedSince: null },
      ]);
      prisma.worker.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.id === 'c' ? 0 : 1 }));
      expect(await svc.refreshBlocks(new Date())).toBe(2);
      expect(notifications.notify).toHaveBeenCalledTimes(2);
    });
  });
});
