import { currencyExponent } from '@fixli/shared';

/** Integer minor units + ISO currency -> "Rs 1,500" in the reader's language. Mirrors the app's formatMoney. */
export function formatMoney(minor: number, currency: string, locale = 'en'): string {
  try {
    // Decimals come from our own config: the runtime's ICU data differs between Node versions.
    const digits = currencyExponent(currency);
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  } catch {
    return `${currency} ${minor}`;
  }
}
