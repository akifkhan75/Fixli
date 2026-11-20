import { SweeperService } from './sweeper.service';

describe('SweeperService', () => {
  const prisma: any = {
    offer: { findMany: jest.fn(), updateMany: jest.fn() },
    jobRequest: { findMany: jest.fn() },
    conversation: { updateMany: jest.fn() },
  };
  const matching = { matchJob: jest.fn() };
  const cfg: Record<string, unknown> = {};
  const config = { get: jest.fn((k: string) => cfg[k]) };
  const realtime = { emitToUsers: jest.fn() };
  const lease: any = { expect: jest.fn(), runExclusive: jest.fn((_n: string, _ms: number, fn: () => unknown) => fn()) };
  const make = () => new SweeperService(prisma, matching as any, config as any, realtime as any, lease as any);

  beforeEach(() => {
    jest.resetAllMocks();
    for (const k of Object.keys(cfg)) delete cfg[k];
    config.get.mockImplementation((k: string) => cfg[k]);
    lease.runExclusive.mockImplementation((_n: string, _ms: number, fn: () => unknown) => fn());
    prisma.offer.findMany.mockResolvedValue([]);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    prisma.jobRequest.findMany.mockResolvedValue([]);
    prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
  });

  it('expires due offers and tells both sides', async () => {
    prisma.offer.findMany.mockResolvedValue([{ id: 'o1', jobRequestId: 'j1', workerId: 'w1', jobRequest: { customerId: 'c1' } }]);
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    const out = await make().sweep();
    expect(out).toMatchObject({ expired: 1 });
    expect(prisma.offer.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1'] }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1'], 'offers.updated', { jobId: 'j1' });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['w1'], 'feed.updated', { jobId: 'j1' });
  });

  it('matches unmatched requests in round 1 and widens stale ones in round 2', async () => {
    prisma.jobRequest.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValueOnce([{ id: 'c' }]);
    const out = await make().sweep();
    expect(matching.matchJob.mock.calls).toEqual([['a', 1], ['b', 1], ['c', 2]]);
    expect(out).toMatchObject({ matched: 2, widened: 1 });
  });

  it('uses the configured windows', async () => {
    cfg.REMATCH_AFTER_MINUTES = 5;
    cfg.CONVERSATION_READONLY_DAYS = 1;
    const now = new Date('2026-11-20T12:00:00Z');
    await make().sweep(now);
    const staleWhere = prisma.jobRequest.findMany.mock.calls[1][0].where;
    expect(staleWhere.lastMatchedAt.lte.getTime()).toBe(now.getTime() - 5 * 60_000);
    expect(prisma.conversation.updateMany.mock.calls[0][0].where.jobRequest.updatedAt.lte.getTime()).toBe(now.getTime() - 86_400_000);
  });

  it('closes old chats but keeps them open while a dispute is open', async () => {
    prisma.conversation.updateMany.mockResolvedValue({ count: 3 });
    const out = await make().sweep();
    expect(out?.readOnly).toBe(3);
    expect(prisma.conversation.updateMany.mock.calls[0][0].where.jobRequest.disputes).toEqual({ none: { status: { in: ['OPEN', 'IN_REVIEW'] } } });
  });

  it('does nothing when another instance holds the lease', async () => {
    lease.runExclusive.mockResolvedValue(null);
    expect(await make().sweep()).toBeNull();
    expect(prisma.offer.findMany).not.toHaveBeenCalled();
  });

  describe('background timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('starts only when RUN_BACKGROUND_JOBS is on, once a minute, and stops on shutdown', async () => {
      const off = make(); off.onModuleInit();
      expect(lease.expect).not.toHaveBeenCalled();
      cfg.RUN_BACKGROUND_JOBS = 'true';
      const on = make(); on.onModuleInit();
      expect(lease.expect).toHaveBeenCalledWith('sweeper', 60_000);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(prisma.offer.findMany).toHaveBeenCalledTimes(1);
      on.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(prisma.offer.findMany).toHaveBeenCalledTimes(1);
      off.onModuleDestroy();
    });

    it('a failing sweep is logged, not thrown', async () => {
      cfg.RUN_BACKGROUND_JOBS = true;
      prisma.offer.findMany.mockRejectedValue(new Error('db down'));
      const s = make(); s.onModuleInit();
      await expect(jest.advanceTimersByTimeAsync(60_000)).resolves.not.toThrow();
      s.onModuleDestroy();
    });
  });
});
