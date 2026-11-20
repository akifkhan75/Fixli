// ============================================================
// Fixli i18n System
// Supports English, Arabic (RTL), and Urdu (RTL)
// ============================================================

import { I18nManager } from 'react-native';
import { ar } from './ar';
import { en } from './en';
import { ur } from './ur';

export type SupportedLocale = 'en' | 'ar' | 'ur';

const translations: Record<SupportedLocale, Record<string, string>> = { en, ar, ur };

const RTL_LOCALES: SupportedLocale[] = ['ar', 'ur'];

let currentLocale: SupportedLocale = 'en';

export function setLocale(locale: SupportedLocale) {
  currentLocale = locale;
  const isRTL = RTL_LOCALES.includes(locale);
  I18nManager.forceRTL(isRTL);
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

/** Text for a key in the current language (English if missing). `{name}` placeholders are filled from `params`. */
export function t(key: string, params?: Record<string, string | number>): string {
  const text = translations[currentLocale]?.[key] || translations.en[key] || key;
  return params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text;
}

/** Is there an English sentence for this key? (Used to map server error codes to translated text.) */
export const hasKey = (key: string) => key in translations.en;

/**
 * Text that depends on a count: looks up `key.one` when n is 1, else `key.other`. `{n}` is filled in.
 * (Arabic and Urdu have more plural forms; the drafts use these two until the native review, O13.)
 */
export function tn(key: string, n: number, params: Record<string, string | number> = {}): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}

export function isRTL(): boolean {
  return RTL_LOCALES.includes(currentLocale);
}

export function getDirection(): 'ltr' | 'rtl' {
  return isRTL() ? 'rtl' : 'ltr';
}
