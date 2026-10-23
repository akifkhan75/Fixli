import React from 'react';
import { View } from 'react-native';
import { useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser } from '../../src/store/authSlice';
import { useI18n } from '../../src/hooks/useI18n';
import { useOutbox } from '../../src/hooks/useOutbox';
import { useTheme } from '../../src/hooks/useTheme';
import { outbox } from '../../src/services/outbox';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { EmptyState } from '../../src/components/ds/EmptyState';

/** Everything saved on this phone that hasn't gone through: waiting, or refused by the server (retry or drop it). */
export default function OutboxScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const user = useAppSelector(selectCurrentUser);
  const { items } = useOutbox(user?.id);

  return (
    <Screen title={t('offline.title')} back>
      {!items.length ? <EmptyState title={t('offline.empty')} /> : items.map((i) => (
        <View key={i.id} style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.lg, padding: 16, marginBottom: 12, gap: 8 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{outbox.describe(i)}</Text>
          <Text variant="bodySmall" color={i.status === 'failed' ? theme.colors.errorText : theme.colors.textSecondary}>
            {i.status === 'failed' ? (i.error ?? t('offline.refused')) : t('offline.itemWaiting')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {i.status === 'failed' ? <View style={{ flex: 1 }}><Button title={t('offline.retry')} variant="secondary" onPress={() => void outbox.retry(i.id)} /></View> : null}
            <View style={{ flex: 1 }}><Button title={t('offline.drop')} variant="ghost" onPress={() => void outbox.discard(i.id)} /></View>
          </View>
        </View>
      ))}
    </Screen>
  );
}
