import { StaleNote } from '../../src/components/ds/StaleNote';
import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { isFinished, statusIcon, statusSentence } from '../../src/utils/jobStatus';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';
import { DirIcon } from '../../src/components/ds/DirIcon';

export default function MyJobsScreen() {
  const theme = useTheme();
  const [tab, setTab] = useState<'ACTIVE' | 'PAST'>('ACTIVE');
  const { data, loading, error, reload, staleAt } = useApi(async () => (await api.listJobs()).items, [], { cacheKey: 'customer-bookings' });
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const shown = (data ?? []).filter((j) => (tab === 'PAST') === isFinished(j.status));

  return (
    <Screen title={t('customerBookings.myJobs')} onRefresh={reload} refreshing={loading && !!data}>
      <StaleNote at={staleAt} />
      <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: 10, padding: 3, marginBottom: 20 }} accessibilityRole="tablist">
        {(['ACTIVE', 'PAST'] as const).map((id) => (
          <TouchableOpacity key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
            style={{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: tab === id ? theme.colors.primary : 'transparent' }}>
            <Text variant="bodySmall" weight="bold" color={tab === id ? theme.colors.onPrimary : theme.colors.textSecondary}>{id === 'ACTIVE' ? t('customerBookings.active') : t('customerBookings.past')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !shown.length ? (
        <EmptyState
          icon="calendar-outline"
          title={tab === 'ACTIVE' ? t('customerBookings.youDontHaveAny') : t('customerBookings.nothingHereYet')}
          message={tab === 'ACTIVE' ? t('customerBookings.whenYouAskFor') : t('customerBookings.finishedAndCancelledJobs')}
          actionLabel={tab === 'ACTIVE' ? t('customerBookings.findAService') : undefined}
          onAction={tab === 'ACTIVE' ? () => router.push('/(customer)/(home)' as any) : undefined}
        />
      ) : shown.map((job) => (
        <TouchableOpacity key={job.id} onPress={() => router.push(`/(customer)/job/${job.id}` as any)} activeOpacity={0.8} accessibilityRole="button"
          style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name={statusIcon(job.status)} size={26} color={job.status === 'CANCELLED' ? theme.colors.error : theme.colors.primary} />
          <View style={{ flex: 1, marginHorizontal: 14 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary} numberOfLines={2}>{job.title ?? job.description}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 2 }}>{statusSentence(job.status, 'customer', job.assignedWorker?.user.name)}</Text>
            <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 2 }}>{new Date(job.createdAt).toLocaleDateString()}</Text>
          </View>
          <DirIcon name="chevron-forward" size={20} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      ))}
    </Screen>
  );
}
