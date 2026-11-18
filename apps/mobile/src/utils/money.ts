import { currencyExponent } from '@fixli/shared';

/**
 * Money is stored as integer minor units plus an ISO currency. This is the only place that turns
 * it into text, using the currency's own number of decimals (PKR 2, JPY 0, KWD 3) from the shared
 * country config; never from Intl, which disagrees between runtimes (some say PKR has no decimals).
 */
export function formatMoney(minor: number, currency: string, locale = 'en'): string {
  const digits = currencyExponent(currency);
  const major = minor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits, maximumFractionDigits: digits,
  }).format(major);
}

/** "1500" typed by a user -> 150000 minor units. Returns null for anything that is not a plain positive amount. */
export function parseMajorToMinor(input: string, currency: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const digits = currencyExponent(currency);
  const minor = Math.round(parseFloat(cleaned) * 10 ** digits);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
