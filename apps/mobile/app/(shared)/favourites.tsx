import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Avatar } from '../../src/components/ds/Avatar';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';
import { useI18n } from '../../src/hooks/useI18n';

export default function FavouritesScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { data, loading, error, reload } = useApi(api.getFavorites);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  const remove = async (workerId: string) => {
    setBusy(true); setActionError(undefined);
    try { await api.removeFavorite(workerId); await reload(); } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title={t('favourites.title')} back onRefresh={reload} refreshing={loading}>
      {actionError ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginBottom: 12 }}>{actionError}</Text> : null}
      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon="heart-outline" title={t('favourites.empty.title')} message={t('favourites.empty.message')} />
      ) : data.map((f) => (
        <View key={f.workerId ?? f.worker.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 10, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface }}>
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={() => router.push(`/worker/${f.worker.id}` as any)} accessibilityRole="button" accessibilityLabel={t('favourites.view', { name: f.worker.user.name })}>
            <Avatar name={f.worker.user.name} imageUrl={f.worker.user.profileImageUrl} size="lg" />
            <View style={{ marginStart: 14, flex: 1 }}>
              <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{f.worker.user.name}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                {f.worker.services?.map((s) => s.category?.name).filter(Boolean).slice(0, 2).join(', ') || t('favourites.professional')}{f.worker.rating ? `  ·  ${f.worker.rating.toFixed(1)} ★` : ''}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => remove(f.worker.id)} accessibilityRole="button" accessibilityLabel={t('favourites.remove', { name: f.worker.user.name })} style={{ padding: 10 }}>
            <Ionicons name="heart" size={24} color={theme.colors.error} />
          </TouchableOpacity>
        </View>
      ))}
    </Screen>
  );
}
