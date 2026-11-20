import { LiveLocationService } from './live-location.service';

describe('LiveLocationService', () => {
  const prisma: any = { jobRequest: { findFirst: jest.fn(), findUnique: jest.fn() }, jobLocationPoint: { create: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() } };
  const cfg: Record<string, unknown> = {};
  const routing = { etaMinutes: jest.fn() };
  const make = () => new LiveLocationService(prisma, { get: (k: string) => cfg[k] } as any, routing as any);
  const p = { jobId: 'j1', latitude: 24.9, longitude: 67.1, heading: 90 };
  const job = { customerId: 'c1', latitude: 24.8, longitude: 67.0 };

  beforeEach(() => { jest.resetAllMocks(); for (const k of Object.keys(cfg)) delete cfg[k]; prisma.jobRequest.findFirst.mockResolvedValue(job); routing.etaMinutes.mockResolvedValue(12); });

  it('only the assigned worker, only while en route: anything else is dropped', async () => {
    prisma.jobRequest.findFirst.mockResolvedValue(null);
    expect(await make().accept('w1', p)).toBeNull();
    expect(prisma.jobRequest.findFirst.mock.calls[0][0].where).toEqual({ id: 'j1', assignedWorkerId: 'w1', status: 'EN_ROUTE' });
    expect(prisma.jobLocationPoint.create).not.toHaveBeenCalled();
  });

  it('forwards to the customer with an ETA and stores the first point', async () => {
    const out = await make().accept('w1', p, 100_000);
    expect(out).toMatchObject({ customerId: 'c1', update: { jobId: 'j1', workerId: 'w1', etaMinutes: 12, heading: 90 } });
    expect(prisma.jobLocationPoint.create).toHaveBeenCalledTimes(1);
  });

  it('forwards at most every 5 s and stores at most every 30 s', async () => {
    const s = make();
    await s.accept('w1', p, 100_000);
    expect(await s.accept('w1', p, 102_000)).toBeNull();
    expect(await s.accept('w1', p, 106_000)).not.toBeNull();
    expect(prisma.jobLocationPoint.create).toHaveBeenCalledTimes(1);
    await s.accept('w1', p, 131_000);
    expect(prisma.jobLocationPoint.create).toHaveBeenCalledTimes(2);
  });

  it('a failing routing service or a job without coordinates gives no ETA but still forwards', async () => {
    routing.etaMinutes.mockRejectedValue(new Error('down'));
    expect((await make().accept('w1', p, 1_000_000))?.update.etaMinutes).toBeNull();
    prisma.jobRequest.findFirst.mockResolvedValue({ customerId: 'c1', latitude: null, longitude: null });
    expect((await make().accept('w1', { ...p, heading: undefined }, 2_000_000))?.update.etaMinutes).toBeNull();
  });

  it('forget lets the next update through at once', async () => {
    const s = make();
    await s.accept('w1', p, 100_000);
    s.forget('j1');
    expect(await s.accept('w1', p, 101_000)).not.toBeNull();
  });

  describe('latest', () => {
    it('nothing unless the job is en route and has a stored point', async () => {
      prisma.jobRequest.findUnique.mockResolvedValue({ status: 'ACCEPTED' });
      expect(await make().latest('j1')).toBeNull();
      prisma.jobRequest.findUnique.mockResolvedValue({ status: 'EN_ROUTE', latitude: 1, longitude: 2 });
      prisma.jobLocationPoint.findFirst.mockResolvedValue(null);
      expect(await make().latest('j1')).toBeNull();
    });
    it('returns the last point with an ETA', async () => {
      prisma.jobRequest.findUnique.mockResolvedValue({ status: 'EN_ROUTE', latitude: 1, longitude: 2 });
      prisma.jobLocationPoint.findFirst.mockResolvedValue({ latitude: 3, longitude: 4, heading: null, at: new Date('2026-11-20T10:00:00Z') });
      expect(await make().latest('j1')).toEqual({ jobId: 'j1', latitude: 3, longitude: 4, heading: undefined, etaMinutes: 12, at: '2026-11-20T10:00:00.000Z' });
    });
  });

  it('purgeOld deletes points older than the retention window (default 30 days)', async () => {
    prisma.jobLocationPoint.deleteMany.mockResolvedValue({ count: 7 });
    const now = new Date('2026-11-30T00:00:00Z');
    expect(await make().purgeOld(now)).toBe(7);
    expect(prisma.jobLocationPoint.deleteMany.mock.calls[0][0].where.at.lt.getTime()).toBe(now.getTime() - 30 * 86_400_000);
    cfg.LOCATION_RETENTION_DAYS = 7;
    await make().purgeOld(now);
    expect(prisma.jobLocationPoint.deleteMany.mock.calls[1][0].where.at.lt.getTime()).toBe(now.getTime() - 7 * 86_400_000);
  });
});
