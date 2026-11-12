import { COUNTRIES } from '@fixli/shared';
import { capStatus, commissionConfigFor, computeCommission } from './commission';

const pk = COUNTRIES.PK.commission; // 12%, min 100.00, max 1,500.00, soft 3,000.00, hard 5,000.00 PKR (minor units)

describe('computeCommission', () => {
  it('takes floor(rate) of the amount in integer minor units', () => {
    expect(computeCommission(500_000, pk)).toBe(60_000); // 12% of PKR 5,000
    expect(computeCommission(123_457, pk)).toBe(Math.floor((123_457 * 1200) / 10_000));
  });
  it('applies the per-job minimum', () => expect(computeCommission(20_000, pk)).toBe(10_000));
  it('applies the per-job maximum', () => expect(computeCommission(5_000_000, pk)).toBe(150_000));
  it('never charges more than the job amount', () => expect(computeCommission(6_000, pk)).toBe(6_000));
  it('charges nothing for zero or invalid amounts', () => {
    expect(computeCommission(0, pk)).toBe(0);
    expect(computeCommission(-5, pk)).toBe(0);
    expect(computeCommission(12.5, pk)).toBe(0);
    expect(computeCommission(NaN, pk)).toBe(0);
  });
  it('always returns an integer', () => {
    for (const a of [1, 99, 100_001, 333_333, 999_999]) expect(Number.isInteger(computeCommission(a, pk))).toBe(true);
  });
});

describe('capStatus', () => {
  it('is OK up to the soft limit, WARN above it, BLOCKED above the hard limit', () => {
    expect(capStatus(0, pk)).toBe('OK');
    expect(capStatus(pk.softLimitMinor, pk)).toBe('OK');
    expect(capStatus(pk.softLimitMinor + 1, pk)).toBe('WARN');
    expect(capStatus(pk.hardLimitMinor, pk)).toBe('WARN');
    expect(capStatus(pk.hardLimitMinor + 1, pk)).toBe('BLOCKED');
  });
});

describe('commissionConfigFor', () => {
  it('reads shared country config and falls back to PK for unknown codes', () => {
    expect(commissionConfigFor('pk')).toBe(COUNTRIES.PK.commission);
    expect(commissionConfigFor('ZZ')).toBe(COUNTRIES.PK.commission);
    expect(commissionConfigFor(undefined)).toBe(COUNTRIES.PK.commission);
  });
});
