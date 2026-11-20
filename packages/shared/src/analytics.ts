// ============================================================
// Product analytics: the only events the app may send, and the only properties each may carry
// (doc 16, doc 22 §8.5, doc 27 F7.2).
//
// This is an ALLOW-LIST. A property that isn't listed for an event is dropped; a value that
// doesn't fit its kind is dropped. No kind accepts free text, so a phone number, an address,
// coordinates or a message can't get through by accident. The test in analytics.spec.ts checks
// this for every event.
// ============================================================

/** What a property may hold. Nothing here is free text. */
export type PropKind =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'bool' }
  /** Whole number between min and max (bucketed or bounded: never an identifier). */
  | { kind: 'int'; min: number; max: number }
  /** A short lowercase identifier chosen by us (a screen or rule name), never user input. */
  | { kind: 'slug' };

const e = (...values: string[]): PropKind => ({ kind: 'enum', values });
const bool: PropKind = { kind: 'bool' };
const int = (min: number, max: number): PropKind => ({ kind: 'int', min, max });
const slug: PropKind = { kind: 'slug' };

const ROLE = e('customer', 'worker');
const JOB_STATUS = e('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED');
const OUTBOX_KIND = e('chat', 'job_action', 'job_request');

export const ANALYTICS_EVENTS = {
  // Core funnel
  app_open: {},
  screen_viewed: { screen: slug },
  sign_up_completed: { role: ROLE },
  request_started: { emergency: bool },
  request_step_completed: { step: slug, source: e('typed', 'suggested', 'autofill', 'photo', 'voice') },
  request_sent: { time_ms: int(0, 3_600_000), used_photo: bool, used_voice: bool, emergency: bool },
  offer_viewed: {},
  offer_chosen: {},
  job_status_changed: { status: JOB_STATUS, side: ROLE },
  payment_completed: { method: e('CASH') },
  review_submitted: { rating: int(1, 5), side: ROLE },
  rebook_started: {},
  autofill_applied: { rule: slug },
  autofill_overridden: { rule: slug },
  // Professional funnel
  verification_started: {},
  went_online: {},
  job_accepted: {},
  job_declined: {},
  // Safety (no location, no contact details, ever)
  emergency_opened: { kind: e('life_threatening', 'water', 'electric', 'gas') },
  emergency_call_initiated: {},
  safety_cancel: {},
  incident_created: {},
  // Offline behaviour
  outbox_queued: { kind: OUTBOX_KIND },
  outbox_failed: { kind: OUTBOX_KIND },
} as const satisfies Record<string, Record<string, PropKind>>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

type ValueOf<K extends PropKind> =
  K extends { kind: 'enum'; values: readonly (infer V)[] } ? V
  : K extends { kind: 'bool' } ? boolean
  : K extends { kind: 'int' } ? number
  : string;

/** Typed properties for an event: `track('request_sent', { time_ms: 42000, ... })` is checked by the compiler. */
export type AnalyticsProps<N extends AnalyticsEventName> = {
  -readonly [P in keyof (typeof ANALYTICS_EVENTS)[N]]?: ValueOf<(typeof ANALYTICS_EVENTS)[N][P] & PropKind>;
};

const SLUG = /^[a-z][a-z0-9_]{0,39}$/;

function accepts(spec: PropKind, v: unknown): boolean {
  switch (spec.kind) {
    case 'enum': return typeof v === 'string' && spec.values.includes(v);
    case 'bool': return typeof v === 'boolean';
    case 'int': return typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max;
    case 'slug': return typeof v === 'string' && SLUG.test(v);
  }
}

/**
 * The properties that may be sent for this event, or null if the event isn't on the list.
 * Everything not listed, or not matching its kind, is dropped.
 */
export function sanitizeEvent(name: string, props: Record<string, unknown> = {}): Record<string, string | number | boolean> | null {
  const spec = (ANALYTICS_EVENTS as Record<string, Record<string, PropKind>>)[name];
  if (!spec) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, kind] of Object.entries(spec)) {
    const v = props[key];
    if (v !== undefined && accepts(kind, v)) out[key] = v as string | number | boolean;
  }
  return out;
}
