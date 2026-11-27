import { computeWindow, ScheduleError, tzOffsetMinutes, zonedToUtc } from './schedule';

const KHI = 'Asia/Karachi'; // UTC+5, no DST
const RUH = 'Asia/Riyadh'; // UTC+3

describe('schedule', () => {
  it('knows timezone offsets', () => {
    expect(tzOffsetMinutes(new Date('2026-10-08T00:00:00Z'), KHI)).toBe(300);
    expect(tzOffsetMinutes(new Date('2026-10-08T00:00:00Z'), RUH)).toBe(180);
  });

  it('converts local wall time to UTC', () => {
    expect(zonedToUtc(2026, 10, 9, 8, KHI).toISOString()).toBe('2026-10-09T03:00:00.000Z');
  });

  // 10:00 in Karachi
  const now = new Date('2026-10-08T05:00:00Z');

  it('NOW is the next two hours', () => {
    const w = computeWindow('NOW', { timeZone: KHI, now });
    expect(w.from).toEqual(now);
    expect(w.to.getTime() - now.getTime()).toBe(2 * 3600_000);
  });

  it('TODAY runs until 9 PM local', () => {
    expect(computeWindow('TODAY', { timeZone: KHI, now }).to.toISOString()).toBe('2026-10-08T16:00:00.000Z');
  });

  it('TODAY late at night still gives a usable window', () => {
    const late = new Date('2026-10-08T16:30:00Z'); // 21:30 Karachi
    const w = computeWindow('TODAY', { timeZone: KHI, now: late });
    expect(w.to > late).toBe(true);
  });

  it('TODAY in the last hour of the day never ends before it starts', () => {
    const late = new Date('2026-10-08T18:38:00Z'); // 23:38 Karachi
    const w = computeWindow('TODAY', { timeZone: KHI, now: late });
    expect(w.from).toEqual(late);
    expect(w.to.getTime() - late.getTime()).toBe(3600_000);
  });

  it('TOMORROW with a slot uses local hours', () => {
    const w = computeWindow('TOMORROW', { timeZone: KHI, slot: 'EVENING', now });
    expect(w.from.toISOString()).toBe('2026-10-09T12:00:00.000Z'); // 17:00 local
    expect(w.to.toISOString()).toBe('2026-10-09T16:00:00.000Z'); // 21:00 local
  });

  it('uses the customer\'s own country timezone', () => {
    const w = computeWindow('TOMORROW', { timeZone: RUH, slot: 'MORNING', now });
    expect(w.from.toISOString()).toBe('2026-10-09T05:00:00.000Z'); // 08:00 Riyadh
  });

  it('SCHEDULED needs a day and a slot, not in the past, within 30 days', () => {
    expect(() => computeWindow('SCHEDULED', { timeZone: KHI, now })).toThrow(ScheduleError);
    expect(() => computeWindow('SCHEDULED', { timeZone: KHI, now, date: '2026-10-12' })).toThrow(/morning/);
    expect(() => computeWindow('SCHEDULED', { timeZone: KHI, now, date: '2026-10-01', slot: 'MORNING' })).toThrow(/passed/);
    expect(() => computeWindow('SCHEDULED', { timeZone: KHI, now, date: '2026-12-30', slot: 'MORNING' })).toThrow(/30 days/);
    // a slot that already ended today is refused
    expect(() => computeWindow('SCHEDULED', { timeZone: KHI, now: new Date('2026-10-08T08:00:00Z'), date: '2026-10-08', slot: 'MORNING' })).toThrow(/later time/);
  });

  it('SCHEDULED today in a slot that is still open starts now', () => {
    const w = computeWindow('SCHEDULED', { timeZone: KHI, now, date: '2026-10-08', slot: 'AFTERNOON' });
    expect(w.from.toISOString()).toBe('2026-10-08T07:00:00.000Z');
    const morning = computeWindow('SCHEDULED', { timeZone: KHI, now: new Date('2026-10-08T05:00:00Z'), date: '2026-10-08', slot: 'EVENING' });
    expect(morning.to.toISOString()).toBe('2026-10-08T16:00:00.000Z');
  });
});
