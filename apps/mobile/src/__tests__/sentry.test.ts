jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { slug: 'fixli', version: '2.0.0' } } }));
import * as Sentry from '@sentry/react-native';
import { initSentry, maskText, scrubEvent } from '../observability/sentry';

describe('crash reports from the phone hold no personal data', () => {
  it('masks numbers, emails, tokens and secrets', () => {
    const out = maskText('call +92 300 1234567 or ali@example.com Bearer eyJhbGciOi.eyJzdWIiOiIxMjM0.abcdefgh1234 password=hunter2');
    expect(out).not.toMatch(/1234567|ali@|hunter2|eyJ/);
  });

  it('drops bodies, headers, query strings; keeps only the account id', () => {
    const e = scrubEvent({
      message: 'failed 03001234567',
      request: { url: 'https://api.fixli.pk/api/users?phone=0300123', data: { password: 'x' }, headers: { Authorization: 'Bearer t' }, query_string: 'phone=0300123' },
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'tap 03001234567', data: { url: 'https://x/y?token=s', status_code: 200, body: 'private' } }],
    } as any);
    expect(JSON.stringify(e)).not.toMatch(/password|a@b|1\.2\.3\.4|03001234567|token=s|private|Bearer|0300123/);
    expect(e.user).toEqual({ id: 'u1' });
  });

  it('is off without a real DSN, and the old placeholder never switches it on', () => {
    expect(initSentry(undefined)).toBe(false);
    expect(initSentry('YOUR_SENTRY_DSN')).toBe(false);
    expect(Sentry.init).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, dsn: undefined }));
    expect(initSentry('https://abc@o1.ingest.sentry.io/2')).toBe(true);
    expect(Sentry.init).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, release: 'fixli@2.0.0' }));
  });

  it('no config file ships a placeholder DSN', () => {
    const fs = require('fs');
    for (const f of ['eas.json', 'app.json']) expect(fs.readFileSync(`${__dirname}/../../${f}`, 'utf8')).not.toMatch(/YOUR_SENTRY_DSN/);
  });
});
