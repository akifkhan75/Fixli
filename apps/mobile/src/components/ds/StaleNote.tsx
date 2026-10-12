import React from 'react';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';

/** "Last updated 3:42 pm": shown over saved data when there's no signal, so it's never mistaken for live. */
export function StaleNote({ at }: { at: string | undefined }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  if (!at) return null;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
  return <Text variant="caption" color={theme.colors.textSecondary} style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">{t('offline.lastUpdated', { when })}</Text>;
}
