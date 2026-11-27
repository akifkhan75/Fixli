// Turns "Now / Today / Tomorrow / a day + Morning|Afternoon|Evening" into a UTC time window,
// using the customer's country timezone. No free-typed dates, ever (doc 22 §6.5).

export type WhenOption = 'NOW' | 'TODAY' | 'TOMORROW' | 'SCHEDULED';
export type TimeSlot = 'MORNING' | 'AFTERNOON' | 'EVENING';

const SLOT_HOURS: Record<TimeSlot, [number, number]> = { MORNING: [8, 12], AFTERNOON: [12, 17], EVENING: [17, 21] };
export const MAX_DAYS_AHEAD = 30;

/** Minutes the zone is ahead of UTC at `instant`. */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Local wall-clock time in `timeZone` -> UTC instant. */
export function zonedToUtc(y: number, m: number, d: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000);
}

/** Today's date (y, m, d) as seen in `timeZone`. */
export function localDate(instant: Date, timeZone: string): [number, number, number] {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant).map((x) => [x.type, x.value]));
  return [+p.year, +p.month, +p.day];
}

export class ScheduleError extends Error {}

export function computeWindow(
  when: WhenOption,
  opts: { date?: string; slot?: TimeSlot; timeZone: string; now?: Date },
): { from: Date; to: Date } {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone;
  const [y, m, d] = localDate(now, tz);
  const at = (dy: number, dm: number, dd: number, h: number) => zonedToUtc(dy, dm, dd, h, tz);
  const addDays = (n: number) => {
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] as const;
  };

  switch (when) {
    case 'NOW':
      return { from: now, to: new Date(now.getTime() + 2 * 3600_000) };
    case 'TODAY': {
      const end = at(y, m, d, 21);
      // Late in the evening "today" still means "as soon as possible tonight": until 11 PM,
      // and always at least an hour, so the window never ends before it starts.
      const soonest = new Date(now.getTime() + 3600_000);
      if (end > soonest) return { from: now, to: end };
      const late = at(y, m, d, 23);
      return { from: now, to: late > soonest ? late : soonest };
    }
    case 'TOMORROW': {
      const [ty, tm, td] = addDays(1);
      const [a, b] = opts.slot ? SLOT_HOURS[opts.slot] : [8, 21];
      return { from: at(ty, tm, td, a), to: at(ty, tm, td, b) };
    }
    case 'SCHEDULED': {
      if (!opts.date || !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new ScheduleError('Choose a day.');
      if (!opts.slot) throw new ScheduleError('Choose morning, afternoon or evening.');
      const [sy, sm, sd] = opts.date.split('-').map(Number);
      const dayIndex = Math.round((Date.UTC(sy, sm - 1, sd) - Date.UTC(y, m - 1, d)) / 86_400_000);
      if (Number.isNaN(dayIndex) || dayIndex < 0) throw new ScheduleError('That day has already passed.');
      if (dayIndex > MAX_DAYS_AHEAD) throw new ScheduleError(`You can book up to ${MAX_DAYS_AHEAD} days ahead.`);
      const [a, b] = SLOT_HOURS[opts.slot];
      const from = at(sy, sm, sd, a);
      const to = at(sy, sm, sd, b);
      if (to <= now) throw new ScheduleError('That time has already passed today. Choose a later time.');
      return { from: from < now ? now : from, to };
    }
  }
}
