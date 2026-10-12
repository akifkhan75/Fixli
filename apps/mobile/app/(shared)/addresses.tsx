import React, { useCallback } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';
import { DirIcon } from '../../src/components/ds/DirIcon';

export default function AddressesScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getAddresses);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return (
    <Screen
      title={t('customerProfile.savedAddresses')}
      back
      footer={<Button title={t('sharedAddresses.addAnAddress')} size="lg" variant="primary" onPress={() => router.push('/address-edit' as any)} />}
    >
      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon="location-outline" title={t('sharedAddresses.noSavedAddressesYet')} message={t('sharedAddresses.saveYourHomeOr')} />
      ) : (
        data.map((a) => (
          <TouchableOpacity
            key={a.id}
            onPress={() => router.push({ pathname: '/address-edit', params: { id: a.id } } as any)}
            accessibilityRole="button"
            accessibilityLabel={`${a.label ?? 'Address'}, ${a.streetAddress}, ${a.city}${a.isDefault ? ', default' : ''}`}
            style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons name={a.label === 'Work' ? 'briefcase-outline' : 'home-outline'} size={24} color={theme.colors.primary} />
            <View style={{ flex: 1, marginHorizontal: 14 }}>
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{a.label ?? t('customerRequestService.address')}{a.isDefault ? t('sharedAddresses.default') : ''}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>{[a.buildingDetail, a.streetAddress, a.area, a.city].filter(Boolean).join(', ')}</Text>
              {a.landmark ? <Text variant="caption" color={theme.colors.textTertiary}>{a.landmark}</Text> : null}
            </View>
            <DirIcon name="chevron-forward" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}
