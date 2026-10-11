import { detectContact, normaliseDigits } from './contact-detector';

describe('contact detector', () => {
  it.each([
    ['call me 0300 1234567', 'phone'],
    ['+92-300-1234567', 'phone'],
    ['0300.123.4567', 'phone'],
    ['۰۳۰۰۱۲۳۴۵۶۷', 'phone'],
    ['٠٣٠٠١٢٣٤٥٦٧ پر بات کریں', 'phone'],
    ['see https://example.com/x', 'link'],
    ['www.cheapfix.pk', 'link'],
    ['mail me ali.k@gmail.com', 'email'],
    ['add me on WhatsApp', 'app'],
    ['واٹس ایپ کریں', 'app'],
  ])('flags %s', (text, kind) => {
    expect(detectContact(text)).toContain(kind);
  });

  it.each([
    'It will cost Rs 1,500.00 including parts',
    'About 3.5 hours of work',
    'I can come at 10:30 tomorrow',
    'The model is 2024, size 12 x 18',
    'Total 2500 plus 300 for the pipe',
    'OK, see you then',
    '',
  ])('does not flag "%s"', (text) => {
    expect(detectContact(text)).toEqual([]);
  });

  it('normalises Urdu and Arabic digits', () => {
    expect(normaliseDigits('۱۲۳ ٤٥٦')).toBe('123 456');
  });
});
