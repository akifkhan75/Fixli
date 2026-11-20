import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// Crash reports from phones must not carry personal data (doc 27 F8.2). Same rules as the server:
// no request bodies, no auth headers, no query strings, and phone numbers / emails / tokens masked.

const MASKS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+?\d[\d\s().-]{8,}\d/g, '[number]'],
  [/(password|secret|token|authorization|api[_-]?key)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[hidden]'],
];
export const maskText = (s: string) => MASKS.reduce((acc, [re, to]) => acc.replace(re, to), s);

/** Applied to every event before it leaves the phone. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubEvent(event: any): any {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.headers;
    if (event.request.url) event.request.url = maskText(String(event.request.url).split('?')[0]);
  }
  // Only the account id (which is random), never a name, phone, email or IP.
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  if (event.message) event.message = maskText(String(event.message));
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = maskText(String(ex.value));
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = maskText(String(b.message));
    if (b.data) b.data = { url: typeof b.data.url === 'string' ? maskText(b.data.url.split('?')[0]) : undefined, status_code: b.data.status_code };
  }
  return event;
}

/** Reports only when a real DSN is set (production builds get it from EAS secrets, never from the repo). */
export function initSentry(dsn = process.env.EXPO_PUBLIC_SENTRY_DSN) {
  const enabled = !!dsn && /^https:\/\//.test(dsn);
  Sentry.init({
    dsn: enabled ? dsn : undefined,
    enabled,
    debug: false,
    environment: process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'development' : 'production'),
    release: `${Constants.expoConfig?.slug ?? 'fixli'}@${Constants.expoConfig?.version ?? '0'}`,
    sendDefaultPii: false,
    beforeSend: (e) => scrubEvent(e as any) as any,
    beforeBreadcrumb: (b) => (b.category === 'console' ? null : b),
  });
  return enabled;
}
