import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Avatar } from '../../src/components/ds/Avatar';
import { FavoriteHeart } from '../../src/components/ds/FavoriteHeart';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { humanize } from '../../src/utils/catalog';
import * as api from '../../src/services/api';

/** Professionals you saved, to look at or book again. */
export default function FavoritesScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getFavorites);
  if (loading && !data) return <Screen title="Favourites" back><LoadingState /></Screen>;
  if (error && !data) return <Screen title="Favourites" back><ErrorState message={error} onRetry={reload} /></Screen>;
  return (
    <Screen title="Favourites" back onRefresh={reload} refreshing={loading}>
      {!data?.length ? <EmptyState icon="heart-outline" title="No favourites yet" message="Tap the heart on a professional's profile or a finished job to save them here." /> : null}
      {data?.map((f) => (
        <TouchableOpacity key={f.id} onPress={() => router.push(`/worker/${f.worker.id}` as any)} activeOpacity={0.8} accessibilityRole="button"
          style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={f.worker.user.name} imageUrl={f.worker.user.profileImageUrl} size="md" />
          <View style={{ flex: 1, marginStart: 12 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{f.worker.user.name}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              {f.worker.services.map((s) => humanize(s.category.name)).join(', ')}{f.worker.rating ? ` · ${f.worker.rating.toFixed(1)} ★` : ''}
            </Text>
          </View>
          <FavoriteHeart workerId={f.worker.id} />
        </TouchableOpacity>
      ))}
    </Screen>
  );
}
