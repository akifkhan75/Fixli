import AsyncStorage from '@react-native-async-storage/async-storage';

// Privacy-safe analytics (docs/16_ANALYTICS.md). Events carry controlled dimensions only: never
// phone numbers, addresses, ID documents or message text. The id is the (pseudonymous) user id
// after sign-in, otherwise a random install id. With no PostHog key configured nothing leaves the
// device. Analytics must never break the app: every failure is swallowed.

const ANON_KEY = '@fixli_anon_id';
const FLUSH_AT = 10;
const FLUSH_MS = 10_000;
const MAX_QUEUE = 200;

/** Property names that may carry personal data. Matched as substrings, case-insensitively. */
const PII_KEYS = ['phone', 'email', 'address', 'latitude', 'longitude', 'lat', 'lng', 'location', 'message', 'text', 'description', 'name', 'password', 'secret', 'token', 'cnic', 'id_number', 'reference', 'comment', 'note'];
/** Fields that are ids/keys of our own records and are fine despite matching a fragment above. */
const ALLOWED = new Set(['jobId', 'job_id', 'categoryId', 'category_id']);

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export function stripPII(props: Record<string, unknown> = {}): AnalyticsProps {
  const out: AnalyticsProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED.has(k) && PII_KEYS.some((p) => k.toLowerCase().includes(p))) continue;
    // Only plain values; short strings, so free text cannot slip through under an innocent key.
    if (typeof v === 'string') { if (v.length <= 64) out[k] = v; }
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

interface QueuedEvent { event: string; distinct_id: string; properties: AnalyticsProps; timestamp: string }

export class AnalyticsService {
  private static key = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
  private static host = (process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
  private static queue: QueuedEvent[] = [];
  private static distinctId: string | null = null;
  private static userType: string | null = null;
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static enabled = true;

  /** For tests. */
  static configure(opts: { key?: string; host?: string }) {
    if (opts.key !== undefined) this.key = opts.key;
    if (opts.host !== undefined) this.host = opts.host.replace(/\/+$/, '');
  }

  static get active() { return !!this.key && this.enabled; }

  static async init() {
    if (!this.key) return;
    try {
      let id = await AsyncStorage.getItem(ANON_KEY);
      if (!id) { id = `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; await AsyncStorage.setItem(ANON_KEY, id); }
      if (!this.distinctId) this.distinctId = id;
    } catch { this.distinctId = this.distinctId ?? `anon_${Date.now().toString(36)}`; }
    if (!this.timer) this.timer = setInterval(() => { void this.flush(); }, FLUSH_MS);
  }

  /** Honour an opt-out (settings or a consent screen): drops queued events and sends nothing more. */
  static setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.queue = [];
  }

  static identify(userId: string, type: 'customer' | 'worker') {
    this.distinctId = userId;
    this.userType = type;
  }

  static reset() {
    this.distinctId = null;
    this.userType = null;
    this.queue = [];
    void AsyncStorage.getItem(ANON_KEY).then((id) => { if (id) this.distinctId = id; }).catch(() => undefined);
  }

  static track(event: string, properties?: Record<string, unknown>) {
    if (!this.active) return;
    this.queue.push({
      event,
      distinct_id: this.distinctId ?? 'anon_unknown',
      properties: { ...stripPII(properties), ...(this.userType ? { user_type: this.userType } : {}), $lib: 'fixli-mobile' },
      timestamp: new Date().toISOString(),
    });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= FLUSH_AT) void this.flush();
  }

  static trackScreen(screenName: string, properties?: Record<string, unknown>) {
    this.track('screen_viewed', { screen: screenName, ...properties });
  }

  static async flush() {
    if (!this.active || this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const res = await fetch(`${this.host}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.key, batch }),
      });
      // Server trouble: put them back (bounded) and try again next tick. A 4xx is our bug: drop.
      if (res.status >= 500) this.queue.unshift(...batch.slice(-MAX_QUEUE));
    } catch {
      this.queue.unshift(...batch.slice(-MAX_QUEUE));
    }
  }
}
