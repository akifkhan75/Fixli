import { NotificationType, render } from './templates';

const TYPES = [...new Set((require('fs').readFileSync(require.resolve('./templates.ts'), 'utf8').match(/^  \| '([a-z_.]+)'/gm) as string[]).map((l) => l.replace(/^  \| '|'$/g, '')))] as NotificationType[];
const params = {
  title: 'Fix tap', worker: 'Ali', sender: 'Sara', area: 'Gulshan', distance: 2, minutes: 2, doc: 'ID', status: 'RESOLVED', reason: 'wrong ref',
  price: { minor: 150000, currency: 'PKR' }, commission: { minor: 15000, currency: 'PKR' },
};

describe('notification templates', () => {
  it('has a template for every notification type', () => {
    expect(TYPES.length).toBeGreaterThan(30);
  });

  it.each(['en', 'ur', 'ar'])('%s: every type renders a non-empty title and body within the limits', (loc) => {
    for (const t of TYPES) {
      const { title, body } = render(t, loc, params);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(120);
      expect(body.length).toBeLessThanOrEqual(240);
      expect(`${title} ${body}`).not.toMatch(/undefined|\[object Object\]|NaN/);
    }
  });

  it('formats money amounts with the right decimals (1,500 not 150,000)', () => {
    const { body } = render('payment.confirmed', 'en', params);
    expect(body).toMatch(/1,500/);
    expect(body).not.toMatch(/150,000/);
  });

  it('falls back to English for an unknown or missing language, and to the raw code for an unknown document', () => {
    expect(render('job.arrived', null, params).title).toBe(render('job.arrived', 'en', params).title);
    expect(render('job.arrived', 'xx', params).title).toBe(render('job.arrived', 'en', params).title);
    expect(render('verification.needs_fix', 'en', { ...params, doc: 'PASSPORT' }).body).toContain('PASSPORT');
  });

  it('omits optional parts cleanly (no area, no distance)', () => {
    const { body } = render('job.sos_request', 'en', { title: 'Burst pipe', minutes: 2 });
    expect(body).toContain('Burst pipe');
    expect(body).not.toMatch(/undefined| km/);
  });

  it('cuts overlong text instead of sending it', () => {
    const { title, body } = render('job.arrived', 'en', { worker: 'x'.repeat(500), title: 'y'.repeat(500) });
    expect(title.length).toBe(120);
    expect(body.length).toBe(240);
  });
});
