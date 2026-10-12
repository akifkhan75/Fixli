import * as Sentry from '@sentry/node';

// Crash reports must never carry personal data (doc 27 F8.2). Two layers:
//  1. we don't send request bodies, cookies or auth headers at all;
//  2. anything that looks like a phone number, email, token or card in the text we do send is masked.

const MASKS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+?\d[\d\s().-]{8,}\d/g, '[number]'],
  [/(password|secret|token|authorization|api[_-]?key)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[hidden]'],
];

export const maskText = (s: string) => MASKS.reduce((acc, [re, to]) => acc.replace(re, to), s);

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-ops-token']);

/** Applied to every event before it leaves the server. Exported for tests. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) if (SENSITIVE_HEADERS.has(h.toLowerCase())) delete event.request.headers[h];
    }
    if (event.request.url) event.request.url = maskText(event.request.url.split('?')[0]);
  }
  // Keep only the account id: enough to find the report, nothing that identifies the person.
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  if (event.message) event.message = maskText(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = maskText(ex.value);
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = maskText(b.message);
    if (b.data) b.data = { url: typeof b.data.url === 'string' ? maskText(b.data.url.split('?')[0]) : undefined, status_code: b.data.status_code };
  }
  delete event.server_name;
  return event;
}

/** Call first thing in main.ts, before the Nest app is created, so start-up failures are reported too. */
export function initSentry(env: NodeJS.ProcessEnv = process.env) {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.APP_RELEASE || undefined,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return true;
}

/** Report a server error (5xx) with the request id, so support can match a user's report to the log line. */
export function reportServerError(exception: unknown, ctx: { requestId?: string; userId?: string; route?: string }) {
  Sentry.withScope((scope) => {
    if (ctx.requestId) scope.setTag('requestId', ctx.requestId);
    if (ctx.route) scope.setTag('route', ctx.route);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    Sentry.captureException(exception);
  });
}
