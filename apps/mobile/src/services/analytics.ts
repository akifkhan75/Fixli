import AsyncStorage from '@react-native-async-storage/async-storage';
import { sanitizeEvent, type AnalyticsEventName, type AnalyticsProps } from '@fixli/shared';

/**
 * Anonymous product analytics (doc 16, doc 27 F7.2).
 *  - Only events on the shared allow-list are sent, with only their listed properties
 *    (`sanitizeEvent`), so no phone, address, location or message text can leave the phone.
 *  - Identified by a random id made on this phone, never the account, so events can't be tied to a person.
 *  - Off until the person agrees (Language & appearance > Help improve Fixli), and off in tests.
 *  - Nothing is sent until a provider is configured (D-F7): set EXPO_PUBLIC_ANALYTICS_HOST and
 *    EXPO_PUBLIC_ANALYTICS_KEY (PostHog-compatible capture API, e.g. https://eu.i.posthog.com).
 */
export interface AnalyticsProvider {
  capture(event: string, props: Record<string, string | number | boolean>, anonymousId: string): Promise<void>;
}

export class HttpProvider implements AnalyticsProvider {
  constructor(private readonly host: string, private readonly key: string, private readonly doFetch: typeof fetch = fetch) {}
  async capture(event: string, props: Record<string, string | number | boolean>, anonymousId: string) {
    await this.doFetch(`${this.host.replace(/\/+$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // $process_person_profile false: no person profile is created for this id.
      body: JSON.stringify({ api_key: this.key, event, distinct_id: anonymousId, properties: { ...props, $process_person_profile: false } }),
    });
  }
}

const CONSENT_KEY = '@fixli_analytics_consent';
const ID_KEY = '@fixli_analytics_id';
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export class Analytics {
  private consent = false;
  private id: string | null = null;
  private ready: Promise<void> | null = null;

  constructor(
    private provider: AnalyticsProvider | null,
    private readonly storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage,
    private readonly enabled = true,
  ) {}

  /** Read the saved choice. Safe to call more than once. */
  init() {
    this.ready ??= (async () => {
      try {
        this.consent = (await this.storage.getItem(CONSENT_KEY)) === 'granted';
        this.id = await this.storage.getItem(ID_KEY);
      } catch { this.consent = false; }
    })();
    return this.ready;
  }

  get hasConsent() { return this.consent; }

  async setConsent(granted: boolean) {
    await this.init();
    this.consent = granted;
    if (granted) {
      await this.storage.setItem(CONSENT_KEY, 'granted').catch(() => undefined);
    } else {
      // Withdrawn: forget the choice and the id; a later opt-in starts a new anonymous id.
      this.id = null;
      await Promise.all([this.storage.removeItem(CONSENT_KEY), this.storage.removeItem(ID_KEY)]).catch(() => undefined);
    }
  }

  async track<N extends AnalyticsEventName>(event: N, props?: AnalyticsProps<N>) {
    if (!this.enabled || !this.provider) return;
    await this.init();
    if (!this.consent) return;
    const safe = sanitizeEvent(event, props as Record<string, unknown> | undefined);
    if (!safe) return;
    if (!this.id) {
      this.id = newId();
      await this.storage.setItem(ID_KEY, this.id).catch(() => undefined);
    }
    // Analytics must never break the app or slow a screen: failures are dropped.
    await this.provider.capture(event, safe, this.id).catch(() => undefined);
  }

  screen(screen: string) { return this.track('screen_viewed', { screen }); }
}

const host = process.env.EXPO_PUBLIC_ANALYTICS_HOST;
const key = process.env.EXPO_PUBLIC_ANALYTICS_KEY;

export const analytics = new Analytics(
  host && key ? new HttpProvider(host, key) : null,
  AsyncStorage,
  process.env.NODE_ENV !== 'test',
);
