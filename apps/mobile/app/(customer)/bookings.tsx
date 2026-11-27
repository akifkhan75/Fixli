import { StaleNote } from '../../src/components/ds/StaleNote';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { usePaginated } from '../../src/hooks/usePaginated';
import { Screen } from '../../src/components/ds/Screen';
import { SegmentedTabs } from '../../src/components/ds/SegmentedTabs';
import { JobCard } from '../../src/components/ds/JobCard';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { Button } from '../../src/components/ds/Button';
import { Entrance } from '../../src/components/motion/Entrance';
import { isFinished } from '../../src/utils/jobStatus';
import { ProjectList } from '../../src/components/projects/ProjectList';
import * as api from '../../src/services/api';

export default function MyJobsScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'ACTIVE' | 'PROJECTS' | 'PAST'>('ACTIVE');
  const { items, loading, error, reload, staleAt, more, hasMore, loadingMore, moreError } = usePaginated(api.listJobsPage, [], { cacheKey: 'customer-bookings-page' });
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const shown = (items ?? []).filter((j) => (tab === 'PAST') === isFinished(j.status));

  // A tab can be empty on this page while older pages still hold matches: keep looking.
  useEffect(() => {
    if (tab !== 'PROJECTS' && items && !shown.length && hasMore && !loadingMore && !moreError) void more();
  }, [tab, items, shown.length, hasMore, loadingMore, moreError, more]);

  return (
    <Screen title={t('customerBookings.myJobs')} scroll={false}>
      <StaleNote at={staleAt} />
      <SegmentedTabs
        tabs={[{ id: 'ACTIVE', label: t('customerBookings.active') }, { id: 'PROJECTS', label: t('project.tab') }, { id: 'PAST', label: t('customerBookings.past') }]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'PROJECTS' ? <ProjectList viewer="customer" /> : loading && !items ? <LoadingState /> : error && !items ? <ErrorState message={error} onRetry={reload} /> : (
        <FlatList
          data={shown}
          keyExtractor={(j) => j.id}
          renderItem={({ item, index }) => (
            <Entrance index={index}>
              <JobCard job={item} viewer="customer" locale={locale} onPress={() => router.push(`/(customer)/(home)/job/${item.id}` as any)} />
            </Entrance>
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          initialNumToRender={8}
          windowSize={7}
          onEndReached={() => void more()}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={loading && !!items} onRefresh={reload} tintColor={theme.colors.primary} />}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.colors.primary} style={{ margin: 16 }} /> : moreError ? <Button title={t('sharedSos.tryAgain')} variant="ghost" onPress={() => void more()} /> : null}
          ListEmptyComponent={loadingMore || (hasMore && !moreError) ? null : (
            <EmptyState
              icon="calendar-outline"
              title={tab === 'ACTIVE' ? t('customerBookings.youDontHaveAny') : t('customerBookings.nothingHereYet')}
              message={tab === 'ACTIVE' ? t('customerBookings.whenYouAskFor') : t('customerBookings.finishedAndCancelledJobs')}
              actionLabel={tab === 'ACTIVE' ? t('customerBookings.findAService') : undefined}
              onAction={tab === 'ACTIVE' ? () => router.push('/(customer)/(home)' as any) : undefined}
            />
          )}
        />
      )}
    </Screen>
  );
}
