import React, { useCallback, useState } from 'react';
import { View, Switch, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser } from '../../src/store/authSlice';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { Logo } from '../../src/components/ds/Logo';
import { useI18n } from '../../src/hooks/useI18n';
import { formatMoney } from '../../src/utils/money';
import { NotificationBell } from '../../src/components/ds/NotificationBell';
import { useLiveReload } from '../../src/hooks/useRealtime';
import { useNotifications } from '../../src/hooks/useNotifications';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { statusSentence } from '../../src/utils/jobStatus';
import * as api from '../../src/services/api';

export default function TodayScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const user = useAppSelector(selectCurrentUser);
  const me = useApi(api.getWorkerMe);
  const jobs = useApi(async () => {
    const [active, feed] = await Promise.all([api.listJobGroup('active'), api.getWorkerFeed()]);
    const mine = (p: api.Page<api.JobView>) => p.items.filter((j) => j.assignedWorkerId === user?.id);
    // What needs you first: working, on site, on the way, booked (soonest), then awaiting the customer.
    const order = ['IN_PROGRESS', 'ARRIVED', 'EN_ROUTE', 'ACCEPTED', 'AWAITING_CONFIRMATION'];
    const sorted = mine(active).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || String(a.scheduledFrom ?? '').localeCompare(String(b.scheduledFrom ?? '')));
    return { active: sorted, offered: feed.filter((f) => !f.myOffer || f.myOffer.status !== 'PENDING') };
  }, [user?.id]);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | undefined>();

  const earnings = useApi(() => api.getWorkerEarnings('week'), []);
  useFocusEffect(useCallback(() => { me.reload(); jobs.reload(); earnings.reload(); }, [me.reload, jobs.reload, earnings.reload]));
  // New requests and booking changes appear without pulling to refresh.
  useLiveReload(jobs.reload, ['feed.updated', 'job.updated']);
  // Approval changes the whole screen (verification -> online toggle).
  useLiveReload(me.reload, ['notification.created'], (e) => String(e.data?.type).startsWith('verification.') || e.data?.type === 'worker.activated');
  const { askForPush } = useNotifications();

  const w = me.data;
  const setOnline = async (value: boolean) => {
    setToggling(true);
    setToggleError(undefined);
    try {
      me.setData(await api.patchWorkerMe({ isOnline: value }));
      // Going online is when new-job alerts start to matter: ask now, with that context.
      if (value) void askForPush();
    } catch (e) { setToggleError(friendlyError(e)); } finally { setToggling(false); }
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
      <Logo variant="mark" height={36} />
      <Text variant="h1" weight="bold" color={theme.colors.textPrimary} style={{ flex: 1 }}>Today</Text>
      <NotificationBell />
    </View>
  );

  if (me.loading && !w) return <Screen>{header}<LoadingState /></Screen>;
  if (me.error && !w) return <Screen>{header}<ErrorState message={me.error} onRetry={me.reload} /></Screen>;
  if (!w) return null;

  const next = jobs.data?.active[0];
  const status = w.activationStatus;

  return (
    <Screen onRefresh={() => { me.reload(); jobs.reload(); }} refreshing={me.loading || jobs.loading}>
      {header}

      {status === 'ACTIVE' ? (
        <View style={{ backgroundColor: w.isOnline ? theme.colors.success + '20' : theme.colors.surface, borderColor: w.isOnline ? theme.colors.success : theme.colors.border, borderWidth: 1.5, borderRadius: theme.borderRadius.xl, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name={w.isOnline ? 'radio-button-on' : 'radio-button-off'} size={28} color={w.isOnline ? theme.colors.success : theme.colors.textTertiary} />
          <View style={{ flex: 1, marginHorizontal: 14 }}>
            <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{w.isOnline ? "You're online" : "You're offline"}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{w.isOnline ? 'Customers near you can choose you.' : 'Go online to receive requests.'}</Text>
          </View>
          <Switch value={w.isOnline} disabled={toggling} onValueChange={setOnline} accessibilityLabel="Online" trackColor={{ true: theme.colors.success, false: theme.colors.border }} />
        </View>
      ) : (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 18 }}>
          {status === 'ONBOARDING' ? (
            <>
              <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>Finish setting up</Text>
              <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4, marginBottom: 14 }}>{w.onboarding.percent}% done. Add your skills, area, prices and ID so you can start getting jobs.</Text>
              <Button title="Continue setup" size="lg" variant="primary" onPress={() => router.push('/setup' as any)} />
            </>
          ) : status === 'PENDING_REVIEW' ? (
            <>
              <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>We're checking your documents</Text>
              <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>This usually takes up to 24 hours. We will let you know as soon as you are approved.</Text>
            </>
          ) : (
            <>
              <Text variant="h3" weight="bold" color={theme.colors.error}>Your account is not active</Text>
              <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>Please contact support to find out why.</Text>
            </>
          )}
        </View>
      )}
      {toggleError ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 8 }}>{toggleError}</Text> : null}

      {status === 'ACTIVE' && earnings.data ? (
        <TouchableOpacity onPress={() => router.push('/(worker)/earnings' as any)} activeOpacity={0.8} accessibilityRole="button"
          style={{ backgroundColor: earnings.data.limits.blocked ? theme.colors.error + '18' : theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginTop: 16 }}>
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>TODAY</Text>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 2 }}>{formatMoney(earnings.data.today.gross, earnings.data.currency, locale)}</Text>
          {earnings.data.limits.blocked ? (
            <Text variant="bodySmall" weight="semibold" color={theme.colors.error} style={{ marginTop: 4 }}>New requests are paused: pay what you owe Fixli ({formatMoney(earnings.data.owed, earnings.data.currency, locale)}).</Text>
          ) : earnings.data.owed > 0 ? (
            <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>You owe Fixli {formatMoney(earnings.data.owed, earnings.data.currency, locale)}</Text>
          ) : null}
        </TouchableOpacity>
      ) : null}

      <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 28, marginBottom: 12 }}>Next job</Text>
      {jobs.loading && !jobs.data ? <LoadingState /> : jobs.error && !jobs.data ? <ErrorState message={jobs.error} onRetry={jobs.reload} /> : next ? (
        <TouchableOpacity onPress={() => router.push(`/(worker)/job/${next.id}` as any)} activeOpacity={0.8} accessibilityRole="button"
          style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16 }}>
          <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{next.title ?? next.description}</Text>
          <Text variant="bodySmall" color={theme.colors.primary} style={{ marginTop: 4 }}>{statusSentence(next.status, 'worker')}</Text>
          {next.location ? <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}><Ionicons name="location" size={16} color={theme.colors.textTertiary} /><Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginStart: 6 }}>{next.location}</Text></View> : null}
        </TouchableOpacity>
      ) : (
        <EmptyState icon="calendar-outline" title="No jobs booked yet" message="When a customer books you, your next job will appear here." />
      )}

      {jobs.data?.offered.length ? (
        <TouchableOpacity onPress={() => router.push('/(worker)/jobs' as any)} accessibilityRole="button" activeOpacity={0.8}
          style={{ marginTop: 20, backgroundColor: theme.colors.accent + '15', borderColor: theme.colors.accent, borderWidth: 1, borderRadius: theme.borderRadius.xl, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="notifications" size={24} color={theme.colors.accent} />
          <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary} style={{ flex: 1, marginStart: 14 }}>{jobs.data.offered.length === 1 ? '1 new request near you' : `${jobs.data.offered.length} new requests near you`}</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.accent} />
        </TouchableOpacity>
      ) : null}
    </Screen>
  );
}
