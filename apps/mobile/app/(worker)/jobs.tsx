import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser } from '../../src/store/authSlice';
import { Screen } from '../../src/components/ds/Screen';
import { useLiveReload } from '../../src/hooks/useRealtime';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { formatWindow, statusIcon, statusSentence } from '../../src/utils/jobStatus';
import { formatMoney } from '../../src/utils/money';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';

type Tab = 'NEW' | 'ACTIVE' | 'DONE';

interface Row { id: string; title: string; sub: string; place: string; when: string; badge?: string; emergency?: boolean; canDecline?: boolean }

export default function WorkerJobsScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const user = useAppSelector(selectCurrentUser);
  const [tab, setTab] = useState<Tab>('NEW');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  const list = useApi(async (): Promise<Row[]> => {
    if (tab === 'NEW') {
      const [feed, asked] = await Promise.all([api.getWorkerFeed(), api.listJobs('AWAITING_WORKER')]);
      return [
        ...asked.items.filter((j) => j.assignedWorkerId === user?.id).map((j) => ({
          id: j.id, title: j.title ?? j.description, sub: t('workerJobs.aCustomerChoseYou'), place: [j.area, j.city].filter(Boolean).join(', '),
          when: formatWindow(j.scheduledFrom, j.scheduledTo, j.whenOption, locale), emergency: j.isEmergency,
        })),
        ...feed.map((f) => ({
          id: f.id, title: f.title ?? f.description,
          sub: f.myOffer?.status === 'PENDING' ? t('workerJobs.yourPriceWaiting', { price: formatMoney(f.myOffer.amount, f.myOffer.currency, locale) }) : t('workerJobs.sendYourPrice'),
          place: [f.area, f.city].filter(Boolean).join(', ') + (f.distanceKm != null ? ` · ${f.distanceKm} km` : ''),
          when: formatWindow(f.scheduledFrom, f.scheduledTo, f.whenOption, locale),
          badge: f.myOffer?.status === 'PENDING' ? t('workerJobs.priceSent') : t('workerJobs.new'), emergency: f.isEmergency, canDecline: true,
        })),
      ];
    }
    const pages = [await api.listJobGroup(tab === 'ACTIVE' ? 'active' : 'past')];
    return pages.flatMap((p) => p.items).filter((j) => j.assignedWorkerId === user?.id).map((j) => ({
      id: j.id, title: j.title ?? j.description, sub: statusSentence(j.status, 'worker'),
      place: j.location ?? [j.area, j.city].filter(Boolean).join(', '), when: formatWindow(j.scheduledFrom, j.scheduledTo, j.whenOption, locale),
      badge: j.agreedAmount && j.agreedCurrency ? formatMoney(j.agreedAmount, j.agreedCurrency, locale) : undefined,
    }));
  }, [tab, user?.id, locale], { cacheKey: `worker-jobs:${user?.id}:${tab}` });
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
    DONE: { title: t('workerJobs.noFinishedJobsYet'), message: t('workerJobs.completedJobsWillBe') },
  }[tab];

  return (
    <Screen title={t('worker.jobs')} onRefresh={list.reload} refreshing={list.loading && !!list.data}>
      <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: 10, padding: 3, marginBottom: 20 }} accessibilityRole="tablist">
        {([['NEW', 'New'], ['ACTIVE', 'Booked'], ['DONE', 'Done']] as const).map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
            style={{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: tab === id ? theme.colors.primary : 'transparent' }}>
            <Text variant="bodySmall" weight="bold" color={tab === id ? theme.colors.onPrimary : theme.colors.textSecondary}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {list.loading && !list.data ? <LoadingState /> : list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data?.length ? (
        <EmptyState icon="briefcase-outline" title={empty.title} message={empty.message} />
      ) : list.data.map((r) => (
        <TouchableOpacity key={r.id} onPress={() => router.push(`/(worker)/job/${r.id}` as any)} activeOpacity={0.8} accessibilityRole="button"
          style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 14, borderWidth: r.emergency ? 1.5 : 0, borderColor: theme.colors.sos }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Ionicons name={r.emergency ? 'warning' : tab === 'NEW' ? 'notifications-outline' : statusIcon(tab === 'DONE' ? 'COMPLETED' : 'ACCEPTED')} size={24} color={r.emergency ? theme.colors.sos : theme.colors.primary} />
            <View style={{ flex: 1, marginStart: 12 }}>
              <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{r.title}</Text>
              <Text variant="bodySmall" color={theme.colors.primaryText}>{r.sub}</Text>
            </View>
            {r.badge ? <Text variant="caption" weight="semibold" color={theme.colors.textSecondary}>{r.badge}</Text> : null}
          </View>
          {r.place ? <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 10 }}>{r.place}</Text> : null}
          {r.when ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{r.when}</Text> : null}
          {r.canDecline ? (
            <View style={{ marginTop: 12, flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Button title={t('workerJob.notForMe')} variant="secondary" loading={busy === r.id} disabled={!!busy} onPress={() => decline(r.id)} /></View>
              <View style={{ flex: 1 }}><Button title={t('workerJobs.viewPrice')} variant="primary" disabled={!!busy} onPress={() => router.push(`/(worker)/job/${r.id}` as any)} /></View>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
      {actionError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{actionError}</Text> : null}
    </Screen>
  );
}
