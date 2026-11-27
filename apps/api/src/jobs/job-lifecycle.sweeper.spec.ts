import { JobLifecycleSweeper } from './job-lifecycle.sweeper';

describe('JobLifecycleSweeper', () => {
  const jobs = { autoConfirmDue: jest.fn() };
  const location = { purgeOld: jest.fn() };
  const payments = { autoConfirmDue: jest.fn(), remindDue: jest.fn() };
  const ledger = { refreshBlocks: jest.fn() };
  const lease: any = { expect: jest.fn(), runExclusive: jest.fn((_n: string, _t: number, fn: () => unknown) => fn()) };
  const cfg: Record<string, unknown> = {};
  const make = () => new JobLifecycleSweeper(jobs as any, location as any, lease, { get: (k: string) => cfg[k] } as any, payments as any, ledger as any);

  beforeEach(() => {
    jest.resetAllMocks();
    for (const k of Object.keys(cfg)) delete cfg[k];
    lease.runExclusive.mockImplementation((_n: string, _t: number, fn: () => unknown) => fn());
    jobs.autoConfirmDue.mockResolvedValue(2); payments.autoConfirmDue.mockResolvedValue(1); ledger.refreshBlocks.mockResolvedValue(3); location.purgeOld.mockResolvedValue(4); payments.remindDue.mockResolvedValue(5);
  });

  it('one sweep runs every housekeeping step under the lease and reports each count', async () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(await make().sweep(now)).toEqual({ autoConfirmed: 2, cashAutoConfirmed: 1, cashReminders: 5, workersPausedForBalance: 3, locationPointsDeleted: 4 });
    expect(lease.runExclusive).toHaveBeenCalledWith('job-lifecycle', 300_000, expect.any(Function));
    for (const fn of [jobs.autoConfirmDue, payments.autoConfirmDue, payments.remindDue, ledger.refreshBlocks, location.purgeOld]) expect(fn).toHaveBeenCalledWith(now);
  });

  it('another instance holding the lease means nothing runs here', async () => {
    lease.runExclusive.mockResolvedValue(null);
    expect(await make().sweep()).toBeNull();
  });

  describe('timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('is off unless background jobs are enabled', async () => {
      const s = make(); s.onModuleInit();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(lease.expect).not.toHaveBeenCalled();
      expect(jobs.autoConfirmDue).not.toHaveBeenCalled();
      s.onModuleDestroy();
    });

    it('when enabled it ticks every minute, survives a failing tick, and stops on shutdown', async () => {
      cfg.RUN_BACKGROUND_JOBS = true;
      const s = make(); s.onModuleInit();
      expect(lease.expect).toHaveBeenCalledWith('job-lifecycle', 60_000);
      await jest.advanceTimersByTimeAsync(60_000);
      jobs.autoConfirmDue.mockRejectedValueOnce(new Error('db'));
      await jest.advanceTimersByTimeAsync(60_000);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(jobs.autoConfirmDue).toHaveBeenCalledTimes(3);
      s.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(jobs.autoConfirmDue).toHaveBeenCalledTimes(3);
    });
  });
});
