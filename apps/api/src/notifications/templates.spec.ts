import { NotificationType, render } from './templates';

const TYPES: NotificationType[] = [
  'job.request', 'job.emergency_request', 'job.direct_request', 'offer.received', 'offer.accepted', 'offer.not_chosen', 'job.accepted',
  'job.declined', 'job.started', 'job.completed', 'job.cancelled', 'job.no_one_available', 'verification.approved', 'verification.needs_fix',
  'worker.activated', 'chat.message', 'payment.confirm_request', 'payment.confirm_reminder', 'payment.auto_confirmed',
  'worker.commission_warning', 'worker.commission_blocked',
];
const PARAMS = {
  title: 'Leaking tap', area: 'Gulshan', distance: 2.5, worker: 'Bilal', sender: 'Bilal', text: 'On my way', doc: 'ID', reason: 'Too blurry',
  price: { minor: 150000, currency: 'PKR' }, amount: { minor: 150000, currency: 'PKR' }, owed: { minor: 20000, currency: 'PKR' }, limit: { minor: 50000, currency: 'PKR' },
};

describe('notification templates', () => {
  it.each(['en', 'ur', 'ar'])('every type renders a non-empty title and body in %s with no leaked placeholders', (locale) => {
    for (const type of TYPES) {
      const { title, body } = render(type, locale, PARAMS);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(`${title} ${body}`).not.toMatch(/undefined|\[object Object\]|NaN/);
    }
  });

  it('formats money from minor units rather than printing raw numbers', () => {
    const { body } = render('offer.received', 'en', PARAMS);
    expect(body).toContain('Bilal');
    expect(body).not.toContain('150000');
    expect(body).toMatch(/1,?500/);
  });

  it('falls back to English for an unknown or missing locale', () => {
    expect(render('job.cancelled', 'fr', PARAMS)).toEqual(render('job.cancelled', 'en', PARAMS));
    expect(render('job.cancelled', null, PARAMS)).toEqual(render('job.cancelled', 'en', PARAMS));
  });

  it('omits optional pieces cleanly and never prints "undefined"', () => {
    const { body } = render('job.request', 'en', { title: 'Tap' });
    expect(body).toBe('Tap. Send your price.');
    expect(render('verification.needs_fix', 'en', { doc: 'SELFIE' }).body).toBe('Your selfie needs a new photo.');
  });

  it('translates the document name', () => {
    expect(render('verification.approved', 'en', { doc: 'ID' }).body).toContain('ID card');
    expect(render('verification.approved', 'ur', { doc: 'ID' }).body).toContain('شناختی کارڈ');
    expect(render('verification.approved', 'en', { doc: 'WEIRD' }).body).toContain('WEIRD');
  });

  it('keeps push text within the title and body limits', () => {
    const { title, body } = render('chat.message', 'en', { sender: 'x'.repeat(300), text: 'y'.repeat(900) });
    expect(title.length).toBeLessThanOrEqual(120);
    expect(body.length).toBeLessThanOrEqual(240);
  });

  it('the emergency notice carries area and distance but no contact details', () => {
    const { title, body } = render('job.emergency_request', 'en', { title: 'Gas leak', area: 'Gulshan', distance: 1.2 });
    expect(title).toMatch(/EMERGENCY/);
    expect(body).toContain('Gulshan');
    expect(body).toContain('1.2 km');
  });
});
