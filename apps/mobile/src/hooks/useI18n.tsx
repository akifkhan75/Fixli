import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { getLocale, setLocale, t, tn, SupportedLocale, isRTL } from '../i18n';

const KEY = '@fixli_locale';
const isLocale = (v: unknown): v is SupportedLocale => v === 'en' || v === 'ar' || v === 'ur';

interface I18nContextType {
  locale: SupportedLocale;
  setLanguage: (lang: SupportedLocale) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  tn: typeof tn;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType | null>(null);

/**
 * The chosen language is remembered on the phone and applied before the first screen draws.
 * Changing it redraws all text: the screen stack is keyed by the language (app/_layout.tsx), because
 * most strings are looked up with the plain `t()` as each screen renders.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(getLocale());
  const [ready, setReady] = useState(false);

  const apply = useCallback(async (lang: SupportedLocale) => {
    setLocale(lang);
    setLocaleState(lang);
    const rtl = isRTL();
    if (I18nManager.isRTL !== rtl) {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
      // The layout direction only changes after a reload.
      if (!__DEV__) await Updates.reloadAsync();
    }
  }, []);

  const setLanguage = useCallback(async (lang: SupportedLocale) => {
    await AsyncStorage.setItem(KEY, lang).catch(() => undefined);
    await apply(lang);
  }, [apply]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((saved) => (isLocale(saved) && saved !== getLocale() ? apply(saved) : undefined))
      .catch(() => undefined)
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [apply]);

  if (!ready) return null;
  return (
    <I18nContext.Provider value={{ locale, setLanguage, t, tn, isRtl: isRTL() }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
