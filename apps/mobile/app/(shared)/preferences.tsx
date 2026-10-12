import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { selectAppearance, setAppearance, type Appearance } from '../../src/store/uiSlice';
import { useI18n } from '../../src/hooks/useI18n';
import { useTheme } from '../../src/hooks/useTheme';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { ChipChoice } from '../../src/components/ds/ChipChoice';
import * as api from '../../src/services/api';
import { analytics } from '../../src/services/analytics';
import type { SupportedLocale } from '../../src/i18n';
import { t } from '../../src/i18n';

const LANGUAGES = [
  // Language names are written in their own language on purpose: someone must find theirs even in the wrong one.
  { id: 'en', label: 'English' }, // i18n-ignore
  { id: 'ur', label: 'اردو' }, // i18n-ignore
  { id: 'ar', label: 'العربية' }, // i18n-ignore
];
const APPEARANCES = () => ([
  { id: 'system', label: t('sharedPreferences.automatic') },
  { id: 'light', label: t('sharedPreferences.light') },
  { id: 'dark', label: t('sharedPreferences.dark') },
]);

export default function PreferencesScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const appearance = useAppSelector(selectAppearance);
  const { locale, setLanguage, t } = useI18n();
  const [share, setShare] = useState(false);
  useEffect(() => { void analytics.init().then(() => setShare(analytics.hasConsent)); }, []);

  const changeLanguage = (ids: string[]) => {
    const next = ids[0] as SupportedLocale | undefined;
    if (!next || next === locale) return;
    setLanguage(next);
    // Remember the choice on the account (best effort; the app already switched).
    api.updateMe({ locale: next }).catch(() => undefined);
  };

  return (
    <Screen title={t('customerProfile.languageAppearance')} back>
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>{t('sharedPreferences.language')}</Text>
      <ChipChoice options={LANGUAGES} selectedIds={[locale]} onChange={changeLanguage} />
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 32, marginBottom: 12 }}>{t('sharedPreferences.appearance')}</Text>
      <ChipChoice options={APPEARANCES()} selectedIds={[appearance]} onChange={(ids) => ids[0] && dispatch(setAppearance(ids[0] as Appearance))} />
      <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 12 }}>{t('sharedPreferences.automaticFollowsYourPhones')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 32 }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{t('analytics.title')}</Text>
          <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 4 }}>{t('analytics.explain')}</Text>
        </View>
        <Switch value={share} onValueChange={(v) => { setShare(v); void analytics.setConsent(v); }} accessibilityLabel={t('analytics.title')} />
      </View>
    </Screen>
  );
}
