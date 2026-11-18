import { COUNTRIES, currencyExponent } from './countries';

describe('currencyExponent', () => {
  it('uses the country config, not the runtime', () => {
    for (const c of Object.values(COUNTRIES)) expect(currencyExponent(c.currency.code)).toBe(c.currency.exponent);
    expect(currencyExponent('PKR')).toBe(2);
    expect(currencyExponent('pkr')).toBe(2);
  });
  it('knows common zero- and three-decimal currencies, and defaults to two', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('XYZ')).toBe(2);
  });
});
