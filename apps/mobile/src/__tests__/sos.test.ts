import { FALLBACK_NUMBERS, SOS_ADVICE, SOS_CHOICES, describeContacts, pickAddress, telUrl } from '../utils/sos';

describe('sos helpers', () => {
  it('offers life-threatening plus the three hazards, never a hidden fourth', () => {
    expect(SOS_CHOICES.map((c) => c.id)).toEqual(['LIFE', 'WATER', 'ELECTRICAL', 'GAS']);
  });
  it('gas advice tells people to leave first', () => expect(SOS_ADVICE.GAS).toMatch(/^Leave the building now/));
  it('picks the default address, else the first, else null', () => {
    expect(pickAddress([{ id: 'a', isDefault: false }, { id: 'b', isDefault: true }])).toBe('b');
    expect(pickAddress([{ id: 'a', isDefault: false }, { id: 'c', isDefault: false }])).toBe('a');
    expect(pickAddress([])).toBeNull();
    expect(pickAddress(undefined)).toBeNull();
  });
  it('is honest about trusted contacts', () => {
    const r = (total: number, notified: number) => ({ trustedContacts: { total, notified, smsConfigured: notified > 0 } });
    expect(describeContacts(r(0, 0))).toBeNull();
    expect(describeContacts(r(1, 1))).toBe('We texted your trusted contact.');
    expect(describeContacts(r(3, 3))).toBe('We texted your 3 trusted contacts.');
    expect(describeContacts(r(2, 0))).toMatch(/could not text.*Please call one of them yourself/);
    expect(describeContacts(r(3, 1))).toBe('We texted 1 of your 3 trusted contacts. Please call the others yourself.');
  });
  it('builds dialable tel: links', () => {
    expect(telUrl({ label: 'Police', number: '15' })).toBe('tel:15');
    expect(telUrl({ label: 'x', number: '+92 1122' })).toBe('tel:+921122');
  });
  it('always has offline fallback numbers', () => expect(FALLBACK_NUMBERS.length).toBeGreaterThan(0));
});
