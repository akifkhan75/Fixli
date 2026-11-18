import { SweeperService } from './sweeper.service';

describe('SweeperService.sweep', () => {
  const tx: any = {
    $queryRaw: jest.fn(),
    offer: { findMany: jest.fn(), updateMany: jest.fn() },
    jobRequest: { findMany: jest.fn() },
    conversation: { updateMany: jest.fn() },
  };
  const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
  const matching = { matchJob: jest.fn() };
  const config = { get: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const payments = { sweepCash: jest.fn() };
  const svc = new SweeperService(prisma, matching as any, config as any, realtime as any, payments as any);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    tx.$queryRaw.mockResolvedValue([{ locked: true }]);
    tx.offer.findMany.mockResolvedValue([]); tx.offer.updateMany.mockResolvedValue({ count: 0 });
    tx.jobRequest.findMany.mockResolvedValue([]); tx.conversation.updateMany.mockResolvedValue({ count: 0 });
  });

  it('does nothing when another instance holds the lock', async () => {
    tx.$queryRaw.mockResolvedValue([{ locked: false }]);
    await expect(svc.sweep()).resolves.toBeNull();
    expect(tx.offer.findMany).not.toHaveBeenCalled();
  });

  it('expires due offers and tells both sides', async () => {
    tx.offer.findMany.mockResolvedValue([{ id: 'o1', jobRequestId: 'j1', workerId: 'w1', jobRequest: { customerId: 'c1' } }]);
    tx.offer.updateMany.mockResolvedValue({ count: 1 });
    const r = await svc.sweep();
    expect(r?.expired).toBe(1);
    expect(tx.offer.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1'] }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1'], 'offers.updated', { jobId: 'j1' });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['w1'], 'feed.updated', { jobId: 'j1' });
  });

  it('matches unmatched requests in round 1 and widens stale ones (SOS and normal) in round 2', async () => {
    tx.jobRequest.findMany
      .mockResolvedValueOnce([{ id: 'new1' }])          // unmatched
      .mockResolvedValueOnce([{ id: 'sos1' }])          // SOS with no price
      .mockResolvedValueOnce([{ id: 'old1' }, { id: 'old2' }]); // normal stale
    tx.conversation.updateMany.mockResolvedValue({ count: 4 });
    const r = await svc.sweep();
    expect(matching.matchJob.mock.calls).toEqual([['new1', 1], ['sos1', 2], ['old1', 2], ['old2', 2]]);
    expect(r).toEqual({ expired: 0, matched: 1, widened: 3, readOnly: 4 });
  });

  it('uses the configured windows', async () => {
    config.get.mockImplementation((k: string) => ({ SOS_ESCALATE_SECONDS: 60, REMATCH_AFTER_MINUTES: 5, CONVERSATION_READONLY_DAYS: 1 } as any)[k]);
    const now = new Date('2026-11-18T12:00:00Z');
    await svc.sweep(now);
    const sosWhere = tx.jobRequest.findMany.mock.calls[1][0].where;
    expect(sosWhere.lastMatchedAt.lte).toEqual(new Date(now.getTime() - 60_000));
    expect(tx.jobRequest.findMany.mock.calls[2][0].where.lastMatchedAt.lte).toEqual(new Date(now.getTime() - 5 * 60_000));
    expect(tx.conversation.updateMany.mock.calls[0][0].where.jobRequest.updatedAt.lte).toEqual(new Date(now.getTime() - 86_400_000));
  });

  describe('background timer', () => {
    afterEach(() => { svc.onModuleDestroy(); jest.useRealTimers(); });
    it('starts only when RUN_BACKGROUND_JOBS is on, and runs sweeps plus the cash sweep', async () => {
      jest.useFakeTimers();
      config.get.mockReturnValue(false);
      svc.onModuleInit();
      jest.advanceTimersByTime(61_000);
      expect(payments.sweepCash).not.toHaveBeenCalled();
      config.get.mockImplementation((k: string) => (k === 'RUN_BACKGROUND_JOBS' ? 'true' : undefined));
      payments.sweepCash.mockResolvedValue(undefined);
      svc.onModuleInit();
      await jest.advanceTimersByTimeAsync(61_000);
      expect(payments.sweepCash).toHaveBeenCalledTimes(1);
    });
  });
});
