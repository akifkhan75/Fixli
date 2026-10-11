import type { JobPhase } from '../components/ds/StatusTimeline';

export type JobStatusName = 'CREATED' | 'MATCHES_FOUND' | 'AWAITING_WORKER' | 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED';
export type Viewer = 'customer' | 'worker';

/** One plain sentence per state and viewer (doc 22 §7.3). Raw enum names never reach the screen. */
export function statusSentence(status: string, viewer: Viewer, other?: string | null): string {
  const name = other ?? (viewer === 'customer' ? 'Your professional' : 'The customer');
  switch (status as JobStatusName) {
    case 'CREATED': return viewer === 'customer' ? 'Sending your request…' : 'New request';
    case 'MATCHES_FOUND': return viewer === 'customer' ? 'Waiting for prices from professionals near you' : 'New request near you';
    case 'AWAITING_WORKER': return viewer === 'customer' ? `Waiting for ${name} to confirm` : 'A customer chose you. Please accept or decline.';
    case 'ACCEPTED': return viewer === 'customer' ? `${name} is booked` : 'Booked. Get ready to go.';
    case 'EN_ROUTE': return viewer === 'customer' ? `${name} is on the way` : 'On the way to the customer';
    case 'ARRIVED': return viewer === 'customer' ? `${name} has arrived` : "You've arrived. Take a photo, then start.";
    case 'IN_PROGRESS': return viewer === 'customer' ? `${name} is working on it` : 'Work in progress';
    case 'AWAITING_CONFIRMATION': return viewer === 'customer' ? `${name} has finished. Please check the work and confirm.` : 'Finished. Waiting for the customer to confirm.';
    case 'COMPLETED': return 'Done';
    case 'CANCELLED': return 'Cancelled';
    default: return 'Updating…';
  }
}

export function statusIcon(status: string): 'time-outline' | 'checkmark-circle' | 'close-circle' | 'construct' | 'hourglass-outline' | 'calendar-outline' {
  switch (status as JobStatusName) {
    case 'COMPLETED': return 'checkmark-circle';
    case 'CANCELLED': return 'close-circle';
    case 'IN_PROGRESS':
    case 'ARRIVED':
    case 'EN_ROUTE': return 'construct';
    case 'AWAITING_CONFIRMATION': return 'hourglass-outline';
    case 'ACCEPTED': return 'calendar-outline';
    case 'AWAITING_WORKER': return 'hourglass-outline';
    default: return 'time-outline';
  }
}

/** Maps the server status onto the timeline steps that exist today. */
export function toPhase(status: string): JobPhase {
  switch (status as JobStatusName) {
    case 'ACCEPTED': return 'BOOKED';
    case 'AWAITING_WORKER': return 'OFFERS_READY';
    case 'EN_ROUTE': return 'ON_THE_WAY';
    case 'ARRIVED': return 'ARRIVED';
    case 'IN_PROGRESS': return 'WORKING';
    case 'AWAITING_CONFIRMATION':
    case 'COMPLETED': return 'DONE';
    default: return 'REQUESTED';
  }
}

export const isActive = (s: string) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(s);
export const isFinished = (s: string) => s === 'COMPLETED' || s === 'CANCELLED';

/** One line per timeline event, written for the person reading it. */
export function eventSentence(type: string, viewer: Viewer, payload?: Record<string, unknown> | null): string {
  switch (type) {
    case 'REQUEST_SENT': return viewer === 'customer' ? 'You sent your request' : 'Request sent';
    case 'DETAILS_EDITED': return viewer === 'customer' ? 'You changed the details' : 'Details changed';
    case 'WORKER_REQUESTED': return viewer === 'customer' ? 'You chose a professional' : 'The customer chose you';
    case 'WORKER_ACCEPTED': return viewer === 'customer' ? 'The professional accepted' : 'You accepted';
    case 'WORKER_DECLINED': return viewer === 'customer' ? 'The professional could not take it' : 'You declined';
    case 'EN_ROUTE': return viewer === 'customer' ? 'The professional set off' : 'You set off';
    case 'ARRIVED': return viewer === 'customer' ? 'The professional arrived' : 'You arrived';
    case 'WORK_STARTED': return 'Work started';
    case 'WORK_FINISHED': return viewer === 'customer' ? 'The professional finished' : 'You finished';
    case 'WORK_COMPLETED': return viewer === 'customer' ? 'You confirmed the work is done' : 'The customer confirmed the work';
    case 'AUTO_CONFIRMED': return 'Completed automatically (not confirmed in time)';
    case 'CHANGE_ORDER_PROPOSED': return viewer === 'customer' ? 'Extra work was proposed' : 'You proposed extra work';
    case 'CHANGE_ORDER_APPROVED': return 'Extra work approved; price updated';
    case 'CHANGE_ORDER_DECLINED': return 'Extra work declined';
    case 'PROFESSIONALS_NOTIFIED': {
      const n = Number(payload?.notified ?? 0);
      return viewer === 'customer' ? `We told ${n} professional${n === 1 ? '' : 's'} near you` : 'Request sent to nearby professionals';
    }
    case 'NO_ONE_NEARBY_YET': return viewer === 'customer' ? 'No one was free nearby yet. We keep looking.' : 'Looking for professionals';
    case 'STILL_NO_ONE': return viewer === 'customer' ? 'We looked further away; still no one free' : 'Search widened';
    case 'OFFER_RECEIVED': return viewer === 'customer' ? 'You got a price' : 'A price was sent';
    case 'OFFER_REVISED': return viewer === 'customer' ? 'A professional changed their price' : 'A price was changed';
    case 'OFFER_WITHDRAWN': return 'A price was withdrawn';
    case 'OFFER_ACCEPTED': return viewer === 'customer' ? 'You chose a professional' : 'The customer chose your price';
    case 'CANCELLED': {
      const by = payload?.by;
      const late = payload?.late ? ' (after the professional set off)' : '';
      return (by === 'customer' ? (viewer === 'customer' ? 'You cancelled' : 'The customer cancelled') : by === 'worker' ? 'The professional cancelled' : 'Cancelled') + late;
    }
    default: return 'Updated';
  }
}

export const CANCEL_REASON_LABEL: Record<string, string> = {
  NO_LONGER_NEEDED: "I don't need it any more",
  FOUND_SOMEONE_ELSE: 'I found someone else',
  TOO_SLOW: 'It is taking too long',
  WRONG_DETAILS: 'I entered the wrong details',
  OTHER: 'Other reason',
};

/** "Today, 2–9 PM" / "Tue 14 Oct, 5–9 PM" in the device's language and timezone. */
export function formatWindow(fromIso: string | null, toIso: string | null, when: string | null, locale = 'en'): string {
  if (when === 'NOW') return 'As soon as possible';
  if (!fromIso || !toIso) return '';
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = sameDay(from, today) ? 'Today' : sameDay(from, tomorrow) ? 'Tomorrow'
    : new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(from);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).format(d);
  return `${day}, ${time(from)} – ${time(to)}`;
}
