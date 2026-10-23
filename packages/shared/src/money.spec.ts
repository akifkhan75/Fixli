import { computeCommission, currencyExponent, formatMoney, parseMajorToMinor } from './money';

describe('money', () => {
  it('uses a fixed number of decimals per currency, whatever ICU says', () => {
    expect(currencyExponent('PKR')).toBe(2);
    expect(currencyExponent('jpy')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('XXX')).toBe(2);
  });

  it('formats minor units', () => {
    expect(formatMoney(150000, 'PKR')).toMatch(/1,500(?!\.)/);
    expect(formatMoney(150050, 'PKR')).toMatch(/1,500\.5/);
    expect(formatMoney(500, 'JPY')).toMatch(/500/);
    expect(formatMoney(1234, 'KWD')).toMatch(/1\.234/);
  });

  it('parses what a person types into integer minor units, without float errors', () => {
    expect(parseMajorToMinor('1500', 'PKR')).toBe(150000);
    expect(parseMajorToMinor('1,500.50', 'PKR')).toBe(150050);
    expect(parseMajorToMinor('0.29', 'PKR')).toBe(29);
    expect(parseMajorToMinor('1.005', 'PKR')).toBeNull(); // too many decimals
    expect(parseMajorToMinor('500', 'JPY')).toBe(500);
    expect(parseMajorToMinor('5.5', 'JPY')).toBeNull();
    for (const bad of ['0', '-5', '12abc', '', '1e3']) expect(parseMajorToMinor(bad, 'PKR')).toBeNull();
  });

  it('commission: rate, floor, ceiling, never more than the job', () => {
    const pk = { rateBps: 1200, minMinor: 10_000, maxMinor: 150_000 };
    expect(computeCommission(250_000, pk)).toBe(30_000);    // 12 % of Rs 2,500 = Rs 300
    expect(computeCommission(50_000, pk)).toBe(10_000);     // floor Rs 100
    expect(computeCommission(2_000_000, pk)).toBe(150_000); // ceiling Rs 1,500
    expect(computeCommission(5_000, pk)).toBe(5_000);       // never above the job itself
    expect(computeCommission(0, pk)).toBe(0);
    expect(computeCommission(123_457, pk)).toBe(14_815);    // rounds half up, integers only
  });
});
