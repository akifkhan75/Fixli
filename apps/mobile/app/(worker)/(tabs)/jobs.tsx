import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../src/hooks/useTheme';
import { useI18n } from '../../../src/hooks/useI18n';
import { friendlyError } from '../../../src/hooks/useApi';
import { usePaginated } from '../../../src/hooks/usePaginated';
import { useAppSelector } from '../../../src/hooks/useRedux';
import { selectCurrentUser } from '../../../src/store/authSlice';
import { Screen } from '../../../src/components/ds/Screen';
import { useLiveReload } from '../../../src/hooks/useRealtime';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { Card } from '../../../src/components/ds/Card';
import { SegmentedTabs } from '../../../src/components/ds/SegmentedTabs';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { Entrance } from '../../../src/components/motion/Entrance';
import { formatWindow, statusSentence } from '../../../src/utils/jobStatus';
import { categoryTint } from '../../../src/utils/categoryTint';
import { ProjectList } from '../../../src/components/projects/ProjectList';
import { formatMoney } from '../../../src/utils/money';
import * as api from '../../../src/services/api';

type Tab = 'NEW' | 'ACTIVE' | 'PROJECTS' | 'DONE';

interface Row { id: string; title: string; sub: string; place: string; when: string; category: api.JobView['category']; badge?: string; emergency?: boolean; canDecline?: boolean }

function Line({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
      <Ionicons name={icon} size={16} color={theme.colors.textTertiary} style={{ marginTop: 2 }} />
      <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}

export default function WorkerJobsScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const user = useAppSelector(selectCurrentUser);
  const [tab, setTab] = useState<Tab>('NEW');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  const list = usePaginated(useCallback(async (cursor?: string): Promise<api.Page<Row>> => {
    if (tab === 'PROJECTS') return { items: [], nextCursor: null };
    if (tab === 'NEW') {
      const [feed, asked] = await Promise.all([api.getWorkerFeed(), api.listJobs('AWAITING_WORKER')]);
      return {
        nextCursor: null,
        items: [
          ...asked.items.filter((j) => j.assignedWorkerId === user?.id).map((j): Row => ({
            id: j.id, title: j.title ?? j.description, sub: t('workerJobs.aCustomerChoseYou'), place: [j.area, j.city].filter(Boolean).join(', '),
            when: formatWindow(j.scheduledFrom, j.scheduledTo, j.whenOption, locale), emergency: j.isEmergency, category: j.category,
          })),
          ...feed.map((f): Row => ({
            id: f.id, title: f.title ?? f.description,
            sub: f.myOffer?.status === 'PENDING' ? t('workerJobs.yourPriceWaiting', { price: formatMoney(f.myOffer.amount, f.myOffer.currency, locale) }) : t('workerJobs.sendYourPrice'),
            place: [f.area, f.city].filter(Boolean).join(', ') + (f.distanceKm != null ? ` · ${t('offerCard.kmAway', { km: f.distanceKm })}` : ''),
            when: formatWindow(f.scheduledFrom, f.scheduledTo, f.whenOption, locale),
            badge: f.myOffer?.status === 'PENDING' ? t('workerJobs.priceSent') : t('workerJobs.new'), emergency: f.isEmergency, canDecline: true, category: f.category,
          })),
        ],
      };
    }
    const page = await api.listJobGroup(tab === 'ACTIVE' ? 'active' : 'past', 20, cursor);
    return {
      nextCursor: page.nextCursor,
      items: page.items.filter((j) => j.assignedWorkerId === user?.id).map((j): Row => ({
        id: j.id, title: j.title ?? j.description, sub: statusSentence(j.status, 'worker'),
        place: j.location ?? [j.area, j.city].filter(Boolean).join(', '), when: formatWindow(j.scheduledFrom, j.scheduledTo, j.whenOption, locale),
        badge: j.agreedAmount && j.agreedCurrency ? formatMoney(j.agreedAmount, j.agreedCurrency, locale) : undefined, category: j.category,
      })),
    };
  }, [tab, user?.id, locale, t]), [tab, user?.id, locale], { cacheKey: `worker-jobs-page:${user?.id}:${tab}` });
  useFocusEffect(useCallback(() => { list.reload(); }, [list.reload]));
  useLiveReload(list.reload, ['feed.updated', 'job.updated']);

  const decline = async (id: string) => {
    setBusy(id);
    setActionError(undefined);
    try { await api.notInterested(id); await list.reload(); } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(null); }
  };

  const empty = {
    NEW: { title: t('workerJobs.noNewRequests'), message: t('workerJobs.stayOnlineOnThe') },
    ACTIVE: { title: t('workerJobs.noBookedJobs'), message: t('workerJobs.whenACustomerChooses') },
    PROJECTS: { title: '', message: '' },
    DONE: { title: t('workerJobs.noFinishedJobsYet'), message: t('workerJobs.completedJobsWillBe') },
  }[tab];

  const renderRow = ({ item: r, index }: { item: Row; index: number }) => {
    const tint = r.emergency ? theme.colors.sos : categoryTint(r.category?.name, theme.categoryColors);
    const open = () => router.push(`/(worker)/job/${r.id}` as any);
    return (
      <Entrance index={index}>
        <Card onPress={open} highlight={r.emergency ? theme.colors.sos : undefined} style={{ marginBottom: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={r.emergency ? 'warning' : (r.category?.iconName as keyof typeof Ionicons.glyphMap) ?? 'construct'} size={26} color={tint} />
            </View>
            <View style={{ flex: 1, marginStart: 12 }}>
              <Text variant="bodyLarge" weight="bold" numberOfLines={2}>{r.title}</Text>
              <Text variant="bodySmall" weight="medium" color={theme.colors.primaryText}>{r.sub}</Text>
            </View>
          </View>
          {r.badge ? (
            <View style={{ alignSelf: 'flex-start', marginTop: 10, backgroundColor: theme.colors.primarySoft, borderRadius: theme.borderRadius.full, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text variant="bodySmall" weight="bold" color={theme.colors.primaryText}>{r.badge}</Text>
            </View>
          ) : null}
          {r.place ? <Line icon="location" text={r.place} /> : null}
          {r.when ? <Line icon="time" text={r.when} /> : null}
          {r.canDecline ? (
            <View style={{ marginTop: 14, flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Button title={t('workerJob.notForMe')} variant="secondary" loading={busy === r.id} disabled={!!busy} onPress={() => decline(r.id)} /></View>
              <View style={{ flex: 1 }}><Button title={t('workerJobs.viewPrice')} variant="primary" disabled={!!busy} onPress={open} /></View>
            </View>
          ) : null}
        </Card>
      </Entrance>
    );
  };

  return (
    <Screen title={t('worker.jobs')} scroll={false}>
      <SegmentedTabs
        tabs={[{ id: 'NEW', label: t('workerJobs.tabNew') }, { id: 'ACTIVE', label: t('workerJobs.tabBooked') }, { id: 'PROJECTS', label: t('project.tab') }, { id: 'DONE', label: t('workerJobs.tabDone') }]}
        value={tab}
        onChange={setTab}
      />
      {actionError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginBottom: 8 }}>{actionError}</Text> : null}
      {tab === 'PROJECTS' ? <ProjectList viewer="worker" /> : list.loading && !list.items ? <LoadingState /> : list.error && !list.items ? <ErrorState message={list.error} onRetry={list.reload} /> : (
        <FlatList
          key={tab}
          data={list.items ?? []}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          initialNumToRender={6}
          windowSize={7}
          onEndReached={() => void list.more()}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.loading && !!list.items} onRefresh={list.reload} tintColor={theme.colors.primary} />}
          ListFooterComponent={list.loadingMore ? <ActivityIndicator color={theme.colors.primary} style={{ margin: 16 }} /> : list.moreError ? <Button title={t('sharedSos.tryAgain')} variant="ghost" onPress={() => void list.more()} /> : null}
          ListEmptyComponent={<EmptyState icon="briefcase-outline" title={empty.title} message={empty.message} />}
        />
      )}
    </Screen>
  );
}
