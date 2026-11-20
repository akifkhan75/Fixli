import { maskText, scrubEvent } from './sentry';

describe('crash reports hold no personal data', () => {
  it('masks phone numbers, emails, tokens and secrets in text', () => {
    const out = maskText('Failed for +92 300 1234567 / ali@example.com with Bearer eyJhbGciOi.eyJzdWIiOiIxMjM0.abcdefgh1234 password=hunter2 apiKey: sk-live-123');
    expect(out).not.toMatch(/1234567|ali@|hunter2|sk-live|eyJ/);
    expect(out).toContain('[number]');
    expect(out).toContain('[email]');
    expect(out).toContain('Bearer [token]');
  });

  it('removes bodies, cookies, auth headers, query strings and server name; keeps only the account id', () => {
    const event: any = {
      message: 'boom for 03001234567',
      request: { url: 'https://api.fixli.pk/api/users?phone=0300123&q=1', data: { password: 'x' }, cookies: { a: 'b' }, query_string: 'phone=0300123', headers: { Authorization: 'Bearer abc', 'x-ops-token': 't', accept: 'json' } },
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
      exception: { values: [{ value: 'cannot message ali@example.com' }] },
      breadcrumbs: [{ message: 'call 03001234567', data: { url: 'https://x/y?token=secret', status_code: 200, body: 'private' } }],
      server_name: 'host',
    };
    const out = scrubEvent(event);
    expect(JSON.stringify(out)).not.toMatch(/password|a@b|1\.2\.3\.4|ali@|03001234567|secret|private|Bearer abc|0300123|host/);
    expect(out.request?.headers).toEqual({ accept: 'json' });
    expect(out.user).toEqual({ id: 'u1' });
    expect(out.request?.url).toBe('https://api.fixli.pk/api/users');
  });

  it('does nothing without a DSN (development, tests)', () => {
    const { initSentry } = jest.requireActual('./sentry');
    expect(initSentry({ NODE_ENV: 'test' })).toBe(false);
  });
});
