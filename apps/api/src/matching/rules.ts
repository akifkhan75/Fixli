// Pure matching rules: easy to test and to explain (doc 04 F, doc 08 "match explanation").
import { tzOffsetMinutes, localDate } from '../jobs/schedule';

export interface Hours { weekday: number; startMinute: number; endMinute: number }

/** Local wall time (minute of day) on a local date -> UTC instant. */
function localMinuteToUtc(y: number, m: number, d: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  return new Date(guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000);
}

/**
 * True if any of the worker's working hours (in their own timezone) overlap the job window.
 * Checks each local day the window touches (a window spans at most two days).
 */
export function availableDuring(hours: Hours[], timeZone: string, from: Date, to: Date): boolean {
  if (!hours.length || to <= from) return false;
  const days = new Set<string>();
  for (const t of [from, new Date((from.getTime() + to.getTime()) / 2), to]) days.add(localDate(t, timeZone).join('-'));
  for (const key of days) {
    const [y, m, d] = key.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    for (const h of hours.filter((x) => x.weekday === weekday)) {
      const start = localMinuteToUtc(y, m, d, h.startMinute, timeZone);
      const end = localMinuteToUtc(y, m, d, h.endMinute, timeZone);
      if (start < to && end > from) return true;
    }
  }
  return false;
}

/**
 * 60% closeness within the worker's own travel radius, 40% rating quality. The rating is
 * pulled towards 3.5 until a worker has several reviews, so one 5-star review never outranks
 * a long track record, and new workers still get a fair chance.
 */
export function matchScore(a: { distanceKm: number | null; radiusKm: number; rating: number; ratingCount: number }): number {
  const closeness = a.distanceKm == null ? 0.5 : Math.max(0, 1 - a.distanceKm / Math.max(1, a.radiusKm));
  const prior = 3.5;
  const weight = 3;
  const bayes = (a.rating * a.ratingCount + prior * weight) / (a.ratingCount + weight);
  const quality = (bayes - 1) / 4;
  return Math.round((0.6 * closeness + 0.4 * quality) * 10_000) / 10_000;
}

/** Haversine distance in km (used for tests and for display rounding). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
