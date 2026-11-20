import { LeaseService } from './lease.service';

describe('LeaseService', () => {
  const prisma: any = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  beforeEach(() => { jest.resetAllMocks(); prisma.$queryRaw.mockResolvedValue([{ holder: 'me' }]); prisma.$executeRaw.mockResolvedValue(1); });

  it('runs the job when it wins the lease and releases it afterwards, even if the job throws', async () => {
    const lease = new LeaseService(prisma);
    expect(await lease.runExclusive('sweeper', 1000, async () => 42)).toBe(42);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    await expect(lease.runExclusive('sweeper', 1000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('returns null without running when someone else holds the lease (and releases nothing)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const fn = jest.fn();
    expect(await new LeaseService(prisma).runExclusive('sweeper', 1000, fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('a slow run is not overlapped by the next tick in the same process', async () => {
    const lease = new LeaseService(prisma);
    let finish!: () => void;
    const first = lease.runExclusive('sweeper', 1000, () => new Promise<string>((r) => { finish = () => r('done'); }));
    await new Promise((r) => setImmediate(r));
    expect(await lease.runExclusive('sweeper', 1000, async () => 'second')).toBeNull();
    finish();
    expect(await first).toBe('done');
    expect(await lease.runExclusive('sweeper', 1000, async () => 'third')).toBe('third');
  });

  it('heartbeats: a job is stale once it missed three ticks', () => {
    const lease = new LeaseService(prisma);
    lease.expect('sweeper', 60_000);
    const t = Date.now();
    expect(lease.heartbeats(t + 30_000)[0]).toMatchObject({ name: 'sweeper', everyMs: 60_000, stale: false });
    expect(lease.heartbeats(t + 200_000)[0].stale).toBe(true);
  });

  it('a tick refreshes the heartbeat even when it loses the lease', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const lease = new LeaseService(prisma);
    lease.expect('sweeper', 60_000);
    await lease.runExclusive('sweeper', 1000, async () => 1);
    expect(lease.heartbeats(Date.now() + 1000)[0].stale).toBe(false);
  });
});
