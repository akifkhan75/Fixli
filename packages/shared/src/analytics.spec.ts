import { ANALYTICS_EVENTS, PropKind, sanitizeEvent } from './analytics';

const all = Object.entries(ANALYTICS_EVENTS) as [string, Record<string, PropKind>][];

describe('analytics allow-list', () => {
  it('no event accepts free text: every property is an enum, flag, bounded number or short identifier', () => {
    for (const [, props] of all) for (const k of Object.values(props)) expect(['enum', 'bool', 'int', 'slug']).toContain(k.kind);
  });

  it('no property is named like personal data', () => {
    const banned = /phone|mobile|email|address|lat|lng|lon|coord|location|message|text|body|name|password|token|secret|cnic|id$/i;
    for (const [event, props] of all) for (const key of Object.keys(props)) expect(`${event}.${key}`).not.toMatch(new RegExp(`\\.(${banned.source})`, 'i'));
  });

  it('numbers are bounded (an exact amount, count or coordinate cannot pass as a number)', () => {
    for (const [, props] of all) for (const k of Object.values(props)) if (k.kind === 'int') expect(k.max).toBeLessThanOrEqual(3_600_000);
  });

  it('drops anything not listed, and any value of the wrong kind', () => {
    expect(sanitizeEvent('request_sent', { time_ms: 42_000, used_photo: true, used_voice: false, emergency: false, phone: '+923001234567', address: '12 Main St', latitude: 24.9, message: 'hello' }))
      .toEqual({ time_ms: 42_000, used_photo: true, used_voice: false, emergency: false });
    expect(sanitizeEvent('job_status_changed', { status: 'Customer at 12 Main St', side: 'customer' })).toEqual({ side: 'customer' });
    expect(sanitizeEvent('screen_viewed', { screen: '+923001234567' })).toEqual({});
    expect(sanitizeEvent('screen_viewed', { screen: 'job_detail' })).toEqual({ screen: 'job_detail' });
    expect(sanitizeEvent('review_submitted', { rating: 9, side: 'worker' })).toEqual({ side: 'worker' });
    expect(sanitizeEvent('request_sent', { time_ms: 1.5 })).toEqual({});
  });

  it('an unknown event is refused', () => {
    expect(sanitizeEvent('typed_a_message', { text: 'hi' })).toBeNull();
  });
});
