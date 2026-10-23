import type { JobPhase } from '../components/ds/StatusTimeline';
import { t, tn } from '../i18n';

export type JobStatusName = 'CREATED' | 'MATCHES_FOUND' | 'AWAITING_WORKER' | 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED';
export type Viewer = 'customer' | 'worker';

/** One plain sentence per state and viewer (doc 22 §7.3). Raw enum names never reach the screen. */
export function statusSentence(status: string, viewer: Viewer, other?: string | null): string {
  const name = other ?? (viewer === 'customer' ? t('jobStatus.yourProfessional') : t('jobStatus.theCustomer'));
  const c = viewer === 'customer';
  switch (status as JobStatusName) {
    case 'CREATED': return c ? t('jobStatus.created.customer') : t('jobStatus.created.worker');
    case 'MATCHES_FOUND': return c ? t('jobStatus.matches.customer') : t('jobStatus.matches.worker');
    case 'AWAITING_WORKER': return c ? t('jobStatus.awaiting.customer', { name }) : t('jobStatus.awaiting.worker');
    case 'ACCEPTED': return c ? t('jobStatus.accepted.customer', { name }) : t('jobStatus.accepted.worker');
    case 'EN_ROUTE': return c ? t('jobStatus.enRoute.customer', { name }) : t('jobStatus.enRoute.worker');
    case 'ARRIVED': return c ? t('jobStatus.arrived.customer', { name }) : t('jobStatus.arrived.worker');
    case 'IN_PROGRESS': return c ? t('jobStatus.inProgress.customer', { name }) : t('jobStatus.inProgress.worker');
    case 'AWAITING_CONFIRMATION': return c ? t('jobStatus.finished.customer', { name }) : t('jobStatus.finished.worker');
    case 'COMPLETED': return t('jobStatus.done');
    case 'CANCELLED': return t('jobStatus.cancelled');
    default: return t('jobStatus.updating');
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
  const c = viewer === 'customer';
  const pick = (key: string) => t(`jobEvent.${key}.${c ? 'customer' : 'worker'}`);
  switch (type) {
    case 'REQUEST_SENT': return pick('requestSent');
    case 'DETAILS_EDITED': return pick('detailsEdited');
    case 'WORKER_REQUESTED': return pick('workerRequested');
    case 'WORKER_ACCEPTED': return pick('workerAccepted');
    case 'WORKER_DECLINED': return pick('workerDeclined');
    case 'EN_ROUTE': return pick('enRoute');
    case 'ARRIVED': return pick('arrived');
    case 'WORK_STARTED': return t('jobEvent.workStarted');
    case 'WORK_FINISHED': return pick('workFinished');
    case 'WORK_COMPLETED': return pick('workCompleted');
    case 'AUTO_CONFIRMED': return t('jobEvent.autoConfirmed');
    case 'CHANGE_ORDER_PROPOSED': return pick('changeProposed');
    case 'CHANGE_ORDER_APPROVED': return t('jobEvent.changeApproved');
    case 'CHANGE_ORDER_DECLINED': return t('jobEvent.changeDeclined');
    case 'REASSIGNED': return pick('reassigned');
    case 'PROFESSIONALS_NOTIFIED': {
      const n = Number(payload?.notified ?? 0);
      return c ? tn('jobEvent.notified', n) : t('jobEvent.notifiedWorker');
    }
    case 'NO_ONE_NEARBY_YET': return pick('noOneYet');
    case 'STILL_NO_ONE': return pick('stillNoOne');
    case 'OFFER_RECEIVED': return pick('offerReceived');
    case 'OFFER_REVISED': return pick('offerRevised');
    case 'OFFER_WITHDRAWN': return t('jobEvent.offerWithdrawn');
    case 'OFFER_ACCEPTED': return pick('offerAccepted');
    case 'CANCELLED': {
      const by = payload?.by;
      const late = payload?.late ? ` ${t('jobEvent.lateCancel')}` : '';
      return (by === 'customer' ? pick('cancelledBy') : by === 'worker' ? t('jobEvent.cancelledByProfessional') : t('jobStatus.cancelled')) + late;
    }
    default: return t('jobEvent.updated');
  }
}

/** Reasons a customer can give for cancelling (getters: they follow the language as it changes). */
export const CANCEL_REASON_LABEL: Record<string, string> = {
  get NO_LONGER_NEEDED() { return t('cancelReason.noLongerNeeded'); },
  get FOUND_SOMEONE_ELSE() { return t('cancelReason.foundSomeoneElse'); },
  get TOO_SLOW() { return t('cancelReason.tooSlow'); },
  get WRONG_DETAILS() { return t('cancelReason.wrongDetails'); },
  get OTHER() { return t('cancelReason.other'); },
};

/** "Today, 2–9 PM" / "Tue 14 Oct, 5–9 PM" in the device's language and timezone. */
export function formatWindow(fromIso: string | null, toIso: string | null, when: string | null, locale = 'en'): string {
  if (when === 'NOW') return t('jobStatus.asap');
  if (!fromIso || !toIso) return '';
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = sameDay(from, today) ? t('jobStatus.today') : sameDay(from, tomorrow) ? t('jobStatus.tomorrow')
    : new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(from);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).format(d);
  return `${day}, ${time(from)} – ${time(to)}`;
}
