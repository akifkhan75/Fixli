import { isBlocked } from './ledger.service';
import { periodStart, zonedMidnight } from './earnings.service';

describe('owed-balance limits', () => {
  const limits = { softMinor: 300_000, hardMinor: 500_000, maxDaysOwed: 7 };
  const now = new Date('2026-10-11T10:00:00Z');
  it('pauses at the hard limit, or after owing for too long; never when nothing is owed', () => {
    expect(isBlocked(0, null, limits, now)).toBe(false);
    expect(isBlocked(499_999, now, limits, now)).toBe(false);
    expect(isBlocked(500_000, now, limits, now)).toBe(true);
    expect(isBlocked(10_000, new Date(now.getTime() - 8 * 86_400_000), limits, now)).toBe(true);
    expect(isBlocked(10_000, new Date(now.getTime() - 6 * 86_400_000), limits, now)).toBe(false);
  });
});

describe('earnings periods in the worker\'s timezone', () => {
  it('local midnight in Karachi is 19:00 UTC the day before', () => {
    expect(zonedMidnight(2026, 10, 11, 'Asia/Karachi').toISOString()).toBe('2026-10-10T19:00:00.000Z');
  });
  it('day, week (Monday) and month start where the worker lives', () => {
    // Sunday 11 Oct 2026, 02:00 in Karachi (= Saturday 21:00 UTC)
    const now = new Date('2026-10-10T21:00:00Z');
    expect(periodStart(now, 'Asia/Karachi', 'day').toISOString()).toBe('2026-10-10T19:00:00.000Z');
    expect(periodStart(now, 'Asia/Karachi', 'week').toISOString()).toBe('2026-10-04T19:00:00.000Z'); // Mon 5 Oct local
    expect(periodStart(now, 'Asia/Karachi', 'month').toISOString()).toBe('2026-09-30T19:00:00.000Z'); // 1 Oct local
  });
  it('handles a DST zone too', () => {
    // 1 Nov 2026 is the US DST end; local midnight that day in New York is 04:00 UTC
    expect(zonedMidnight(2026, 11, 1, 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(zonedMidnight(2026, 11, 2, 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});
