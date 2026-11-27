import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { useApi } from '../../hooks/useApi';
import { usePaginated } from '../../hooks/usePaginated';
import { useLiveReload } from '../../hooks/useRealtime';
import { useAppSelector } from '../../hooks/useRedux';
import { selectCurrentUser } from '../../store/authSlice';
import * as api from '../../services/api';
import { EmptyState, ErrorState, LoadingState } from '../ds/EmptyState';
import { Button } from '../ds/Button';
import { Text } from '../ds/Text';
import { ProjectCard } from './ProjectCard';

type Row =
  | { id: string; kind: 'heading'; label: string }
  | { id: string; kind: 'open'; project: api.ProjectFeedItem }
  | { id: string; kind: 'mine'; project: api.ProjectListItem };

/** A customer's projects; for a professional, the ones they're hired for plus open ones to price. */
export function ProjectList({ viewer }: { viewer: 'customer' | 'worker' }) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const user = useAppSelector(selectCurrentUser);
  const mine = usePaginated(api.listProjects, [user?.id], { cacheKey: `projects:${user?.id}` });
  const feed = useApi(() => (viewer === 'worker' ? api.getProjectFeed() : Promise.resolve([])), [viewer, user?.id], { cacheKey: `project-feed:${user?.id}` });
  const reload = useCallback(() => { mine.reload(); feed.reload(); }, [mine.reload, feed.reload]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useLiveReload(reload, ['project.updated', 'feed.updated']);

  if (mine.loading && !mine.items) return <LoadingState />;
  if (mine.error && !mine.items) return <ErrorState message={mine.error} onRetry={reload} />;

  const open = feed.data ?? [];
  const hired = mine.items ?? [];
  const rows: Row[] = [
    ...(viewer === 'worker' && open.length ? [{ id: 'h-open', kind: 'heading' as const, label: t('project.openNearYou') }] : []),
    ...open.map((project) => ({ id: `o-${project.id}`, kind: 'open' as const, project })),
    ...(viewer === 'worker' && hired.length ? [{ id: 'h-mine', kind: 'heading' as const, label: t('project.yourProjects') }] : []),
    ...hired.map((project) => ({ id: `m-${project.id}`, kind: 'mine' as const, project })),
  ];

  return (
    <FlatList
      key={`${viewer}-${locale}`}
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={({ item, index }) => (item.kind === 'heading'
        ? <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{item.label}</Text>
        : <ProjectCard project={item.project} viewer={viewer} index={index} />)}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
      initialNumToRender={6}
      windowSize={7}
      onEndReached={() => void mine.more()}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={mine.loading && !!mine.items} onRefresh={reload} tintColor={theme.colors.primary} />}
      ListFooterComponent={mine.loadingMore ? <ActivityIndicator color={theme.colors.primary} style={{ margin: 16 }} /> : mine.moreError ? <Button title={t('sharedSos.tryAgain')} variant="ghost" onPress={() => void mine.more()} /> : <View />}
      ListEmptyComponent={
        <EmptyState icon="business-outline"
          title={viewer === 'customer' ? t('project.noneYet') : t('project.noneOpen')}
          message={viewer === 'customer' ? t('project.getWorkDoneHint') : t('project.noneOpenHint')}
          actionLabel={viewer === 'customer' ? t('project.getWorkDone') : undefined}
          onAction={viewer === 'customer' ? () => router.push('/(customer)/(home)/project/new' as any) : undefined} />
      }
    />
  );
}
