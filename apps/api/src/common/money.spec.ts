import { formatMoney } from './money';

describe('formatMoney', () => {
  it('shows 150000 PKR minor units as 1,500 rupees regardless of what the runtime thinks PKR has', () => {
    // Node 22's ICU (CI) reports zero decimals for PKR; Node 24 reports two. The result must not depend on it.
    const real = Intl.NumberFormat.prototype.resolvedOptions;
    const spy = jest.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.NumberFormat) {
      return { ...real.call(this), maximumFractionDigits: 0, minimumFractionDigits: 0 } as Intl.ResolvedNumberFormatOptions;
    });
    try {
      expect(formatMoney(150000, 'PKR')).toMatch(/1,500(\.00)?$/);
    } finally { spy.mockRestore(); }
  });
  it('keeps real decimals and handles zero-decimal currencies', () => {
    expect(formatMoney(150050, 'PKR')).toMatch(/1,500\.50$/);
    expect(formatMoney(1500, 'JPY')).toMatch(/1,500$/);
  });
});
