// ============================================================
// Money: integer minor units + ISO currency, everywhere (server, app, admin).
//
// The number of decimals per currency is fixed HERE, never asked of Intl: ICU versions disagree
// (Node 22 / ICU 78 says PKR has 0 decimals, Node 24 / ICU 77 says 2), which made the same "1500"
// mean Rs 1,500 on one machine and Rs 15 on another (doc 26 9.10). Intl only formats the text.
// ============================================================

/** Decimals used for stored minor units. Changing one breaks stored amounts: add, never edit. */
export const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  PKR: 2, INR: 2, AED: 2, SAR: 2, BDT: 2, USD: 2, EUR: 2, GBP: 2,
  JPY: 0, KWD: 3, BHD: 3, OMR: 3,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENT[currency?.toUpperCase()] ?? 2;
}

/** 150000 PKR -> "Rs 1,500" (decimals shown only when there are any). */
export function formatMoney(minor: number, currency: string, locale = 'en'): string {
  const e = currencyExponent(currency);
  const major = minor / 10 ** e;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: e }).format(major);
  } catch {
    return `${currency} ${major.toFixed(e).replace(/\.0+$/, '')}`;
  }
}

/** "1,500" typed by a person -> 150000 minor units (PKR). Null for anything but a plain positive amount. */
export function parseMajorToMinor(input: string, currency: string): number | null {
  const cleaned = (input ?? '').replace(/[,\s]/g, '');
  const e = currencyExponent(currency);
  if (!(e === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${e}})?$`)).test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  // String arithmetic: no floating-point rounding (0.29 * 100 = 28.999…).
  const minor = Number(whole) * 10 ** e + Number((frac + '0'.repeat(e)).slice(0, e) || 0);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export interface CommissionRule {
  /** Basis points: 1200 = 12 %. */
  rateBps: number;
  /** Floor and ceiling per job, minor units of the country currency. */
  minMinor: number;
  maxMinor: number;
}

/** Fixli's commission on a cash job: round(amount × rate), kept between the floor and ceiling. Integers only. */
export function computeCommission(amountMinor: number, rule: CommissionRule): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return 0;
  const raw = Math.round((amountMinor * rule.rateBps) / 10_000);
  return Math.min(Math.max(raw, rule.minMinor), rule.maxMinor, amountMinor);
}
