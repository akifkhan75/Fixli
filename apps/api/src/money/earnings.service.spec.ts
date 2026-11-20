import { EarningsService, periodStart, zonedMidnight } from './earnings.service';

describe('time helpers', () => {
  it('local midnight in Karachi (UTC+5) is 19:00 UTC the day before', () => {
    expect(zonedMidnight(2026, 11, 20, 'Asia/Karachi').toISOString()).toBe('2026-11-19T19:00:00.000Z');
  });
  it('handles zones behind UTC and daylight saving', () => {
    expect(zonedMidnight(2026, 11, 20, 'America/New_York').toISOString()).toBe('2026-11-20T05:00:00.000Z');
    expect(zonedMidnight(2026, 7, 1, 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });
  it('day, week (Monday) and month starts in the worker\'s timezone', () => {
    const now = new Date('2026-11-19T22:00:00Z'); // Fri 20 Nov, 03:00 in Karachi
    expect(periodStart(now, 'Asia/Karachi', 'day').toISOString()).toBe('2026-11-19T19:00:00.000Z');
    expect(periodStart(now, 'Asia/Karachi', 'week').toISOString()).toBe('2026-11-15T19:00:00.000Z'); // Mon 16 Nov
    expect(periodStart(now, 'Asia/Karachi', 'month').toISOString()).toBe('2026-10-31T19:00:00.000Z'); // 1 Nov
  });
  it('a Monday is its own week start', () => {
    expect(periodStart(new Date('2026-11-16T10:00:00Z'), 'Asia/Karachi', 'week').toISOString()).toBe('2026-11-15T19:00:00.000Z');
  });
});

describe('EarningsService', () => {
  const prisma: any = {
    worker: { findUniqueOrThrow: jest.fn() }, payment: { aggregate: jest.fn() }, ledgerEntry: { aggregate: jest.fn(), findMany: jest.fn() }, settlement: { findFirst: jest.fn() },
  };
  const countries = { forWorker: jest.fn() };
  const svc = new EarningsService(prisma, countries as any);
  beforeEach(() => {
    jest.resetAllMocks();
    countries.forWorker.mockResolvedValue({ currency: 'PKR', cashLimits: { softMinor: 3000, hardMinor: 5000, maxDaysOwed: 7 }, commission: { rateBps: 1200 }, settlementRails: [{ id: 'BANK' }] });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 100_000 }, _count: 4 });
    prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 12_000 } });
    prisma.settlement.findFirst.mockResolvedValue(null);
  });

  it('summary: earned is income, net is income minus commission, and the limits show where they stand', async () => {
    prisma.worker.findUniqueOrThrow.mockResolvedValue({ timezone: null, ledgerBalance: 3500, owedSince: new Date('2026-11-15T00:00:00Z'), balanceBlocked: false });
    const s = await svc.summary('w1', 'month', new Date('2026-11-20T10:00:00Z'));
    expect(s).toMatchObject({ currency: 'PKR', period: 'month', gross: 100_000, commission: 12_000, net: 88_000, jobs: 4, owed: 3500, owedSince: '2026-11-15T00:00:00.000Z', pendingSettlement: null });
    expect(s.limits).toEqual({ softMinor: 3000, hardMinor: 5000, maxDaysOwed: 7, overSoft: true, blocked: false });
    expect(s.today.net).toBe(88_000);
  });

  it('nothing earned or owed yet reads as zeros', async () => {
    prisma.worker.findUniqueOrThrow.mockResolvedValue({ timezone: 'Asia/Karachi', ledgerBalance: 0, owedSince: null, balanceBlocked: false });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
    prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const s = await svc.summary('w1');
    expect(s).toMatchObject({ period: 'week', gross: 0, commission: 0, net: 0, jobs: 0, owed: 0, owedSince: null });
    expect(s.limits.overSoft).toBe(false);
  });

  describe('ledger', () => {
    const row = (id: string) => ({ id, type: 'COMMISSION_OWED', jobRequest: id === 'a' ? { title: 'Fix tap' } : null });
    it('pages newest first with the job title and a cursor when there is more', async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);
      const out = await svc.ledger('w1', 'cur', 2);
      expect(out.items.map((i: any) => [i.id, i.jobTitle])).toEqual([['a', 'Fix tap'], ['b', null]]);
      expect(out.nextCursor).toBe('b');
      expect(prisma.ledgerEntry.findMany.mock.calls[0][0]).toMatchObject({ take: 3, cursor: { id: 'cur' }, skip: 1 });
    });
    it('the last page has no cursor and the page size is capped at 50', async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([row('a')]);
      expect((await svc.ledger('w1')).nextCursor).toBeNull();
      await svc.ledger('w1', undefined, 500);
      expect(prisma.ledgerEntry.findMany.mock.calls[1][0].take).toBe(51);
      expect(prisma.ledgerEntry.findMany.mock.calls[1][0].cursor).toBeUndefined();
    });
  });
});
