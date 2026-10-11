import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useI18n } from '../../../src/hooks/useI18n';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { Avatar } from '../../../src/components/ds/Avatar';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { TextInput } from '../../../src/components/ds/TextInput';
import { StatusTimeline } from '../../../src/components/ds/StatusTimeline';
import { JobHistory, JobMedia } from '../../../src/components/ds/JobParts';
import { ChangeOrdersList } from '../../../src/components/ds/ChangeOrdersList';
import { ReviewForm } from '../../../src/components/ds/ReviewForm';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { OfferCard } from '../../../src/components/ds/OfferCard';
import MapView, { Marker } from 'react-native-maps';
import { useAppDispatch, useAppSelector } from '../../../src/hooks/useRedux';
import { useWorkerLiveLocation } from '../../../src/hooks/useWorkerLiveLocation';
import { CallButton } from '../../../src/components/ds/CallButton';
import { formatMoney } from '../../../src/utils/money';
import { CANCEL_REASON_LABEL, formatWindow, statusSentence, toPhase } from '../../../src/utils/jobStatus';
import { humanize, localizedName } from '../../../src/utils/catalog';
import * as api from '../../../src/services/api';
import { useLiveReload } from '../../../src/hooks/useRealtime';

// Job status, prices, extra-work requests and the professional's position update live.
export default function CustomerJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { locale } = useI18n();
  const { data: job, loading, error, reload, setData } = useApi(() => api.getJobView(id), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const open = job?.status === 'MATCHES_FOUND';
  const offers = useApi(() => (open ? api.listOffers(id) : Promise.resolve([])), [id, open]);
  const [confirming, setConfirming] = useState<api.OfferCard | null>(null);

  const mine = (e: { data?: { jobId?: string } }) => e.data?.jobId === id;
  useLiveReload(reload, ['job.updated'], mine);
  useLiveReload(offers.reload, ['offers.updated'], mine, { enabled: open, fallbackMs: 60_000 });
  useEffect(() => { if (confirming && !offers.data?.some((o) => o.id === confirming.id)) setConfirming(null); }, [offers.data, confirming]);

  const currentUser = useAppSelector(state => state.auth.currentUser);
  const live = useWorkerLiveLocation(id, job?.status === 'EN_ROUTE');

  if (loading && !job) return <Screen title="Your request" back><LoadingState /></Screen>;
  if (error && !job) return <Screen title="Your request" back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!job) return null;

  const worker = job.assignedWorker;
  const cancellable = ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED'].includes(job.status);
  const catName = job.category ? localizedName({ name: job.category.translations?.en?.name ?? humanize(job.category.name), translations: job.category.translations }, locale) : '';

  const book = async (offer: api.OfferCard) => {
    setBusy(true);
    setActionError(undefined);
    try {
      await api.acceptOffer(offer.id);
      setConfirming(null);
      await reload();
    } catch (e) {
      setActionError(friendlyError(e));
      await offers.reload();
    } finally { setBusy(false); }
  };

  const confirmCancel = async () => {
    if (!reason[0]) { setActionError('Please choose a reason.'); return; }
    setBusy(true);
    setActionError(undefined);
    try {
      setData(await api.cancelJobWithReason(job.id, reason[0] as api.CancelReason, note.trim() || undefined));
      setCancelling(false);
    } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  const payment = job.payments?.[0];
  const confirmCash = async () => {
    if (!payment) return;
    setBusy(true);
    try {
      await api.confirmPayment(payment.id);
      await reload();
    } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  const footer = !cancellable && job.status !== 'AWAITING_CONFIRMATION' ? undefined : job.status === 'AWAITING_CONFIRMATION' ? (
    <Button title="Confirm Work is Done" variant="primary" size="lg" loading={busy} disabled={busy} onPress={async () => {
      setBusy(true);
      try {
        setData(await api.confirmJob(job.id));
      } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
    }} />
  ) : cancelling ? (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ flex: 1 }}><Button title="Keep request" variant="secondary" size="lg" disabled={busy} onPress={() => setCancelling(false)} /></View>
      <View style={{ flex: 1 }}><Button title="Cancel it" variant="danger" size="lg" loading={busy} disabled={busy} onPress={confirmCancel} /></View>
    </View>
  ) : <Button title="Cancel this request" variant="secondary" size="lg" onPress={() => { setCancelling(true); setActionError(undefined); }} />;

  return (
    <Screen title="Your request" back onRefresh={reload} refreshing={loading} footer={footer}>
      <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{statusSentence(job.status, 'customer', worker?.user.name)}</Text>
      {job.status === 'MATCHES_FOUND' ? (
        <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>
          {job.notifiedCount
            ? `We told ${job.notifiedCount} professional${job.notifiedCount === 1 ? '' : 's'} near you. Prices usually arrive within a few minutes.`
            : job.matchRound && job.matchRound >= 2
              ? 'No professionals are free near you right now. Your request stays open and we will tell new professionals as they come online.'
              : 'Looking for professionals near you…'}
        </Text>
      ) : null}
      
      {job.agreedAmount && job.agreedCurrency && job.status !== 'CANCELLED' ? (
        <View style={{ marginTop: 6 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>Agreed price: {formatMoney(job.agreedAmount, job.agreedCurrency, locale)}</Text>
          {payment?.status === 'MARKED_BY_WORKER' && (
            <View style={{ backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, marginTop: 12 }}>
              <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>Professional requested payment</Text>
              <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>They marked that you paid them in cash. Please confirm this.</Text>
              <View style={{ marginTop: 12 }}>
                <Button title="Confirm Cash Given" variant="primary" loading={busy} disabled={busy} onPress={confirmCash} />
              </View>
            </View>
          )}
          {payment?.status === 'CONFIRMED' && (
            <Text variant="bodySmall" weight="bold" color={theme.colors.success} style={{ marginTop: 8 }}>
              Payment Confirmed
            </Text>
          )}
        </View>
      ) : null}

      {open ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>Prices from professionals</Text>
          {confirming ? (
            <View style={{ backgroundColor: theme.colors.primary + '12', borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 14 }} accessibilityRole="alert">
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>
                Book {confirming.worker.name} for {formatMoney(confirming.amount, confirming.currency, locale)}?
              </Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>They will get your full address. If extra work is needed, they must ask you first.</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <View style={{ flex: 1 }}><Button title="Back" variant="secondary" disabled={busy} onPress={() => setConfirming(null)} /></View>
                <View style={{ flex: 1 }}><Button title="Book" variant="primary" loading={busy} disabled={busy} onPress={() => book(confirming)} /></View>
              </View>
            </View>
          ) : null}
          {offers.data?.length ? offers.data.map((o) => (
            <OfferCard key={o.id} offer={o} locale={locale} onChoose={() => setConfirming(o)} disabled={busy || !!confirming} />
          )) : offers.loading && !offers.data ? <LoadingState message="Checking for prices…" /> : (
            <Text variant="body" color={theme.colors.textSecondary}>No prices yet. This page updates by itself.</Text>
          )}
        </View>
      ) : null}
      {job.status === 'CANCELLED' && job.cancelReason ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>{CANCEL_REASON_LABEL[job.cancelReason] ?? ''}</Text> : null}

      {job.status !== 'CANCELLED' ? (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, marginTop: 16, paddingVertical: 8 }}>
          <StatusTimeline currentPhase={toPhase(job.status)} />
        </View>
      ) : null}

      {job.status === 'EN_ROUTE' ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>
            {live?.etaMinutes != null ? `About ${live.etaMinutes} min away` : 'On the way'}
          </Text>
          {live || (job.latitude != null && job.longitude != null) ? (
            <View style={{ marginTop: 10, height: 200, borderRadius: theme.borderRadius.xl, overflow: 'hidden' }}>
              <MapView
                style={{ flex: 1 }}
                initialRegion={{
                  latitude: live?.latitude ?? job.latitude!,
                  longitude: live?.longitude ?? job.longitude!,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
              >
                {job.latitude != null && job.longitude != null ? <Marker coordinate={{ latitude: job.latitude, longitude: job.longitude }} title="Your address" pinColor="blue" /> : null}
                {live ? <Marker coordinate={{ latitude: live.latitude, longitude: live.longitude }} title="Professional" pinColor="red" /> : null}
              </MapView>
            </View>
          ) : null}
          {!live ? <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginTop: 6 }}>Waiting for their location…</Text> : null}
        </View>
      ) : null}
      {worker && ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(job.status) ? <CallButton jobId={job.id} label="Call the professional" /> : null}

      {cancelling ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 10 }}>Why are you cancelling?</Text>
          <ChipChoice options={Object.entries(CANCEL_REASON_LABEL).map(([id, label]) => ({ id, label }))} selectedIds={reason} onChange={setReason} />
          <View style={{ marginTop: 12 }}><TextInput label="Anything else? (optional)" value={note} onChangeText={setNote} maxLength={300} /></View>
        </View>
      ) : null}
      {actionError ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 12 }}>{actionError}</Text> : null}

      <View style={{ marginTop: 24 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>{catName.toUpperCase()}</Text>
        <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{job.title ?? catName}</Text>
        <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{job.description}</Text>
      </View>
      <JobMedia media={job.media ?? []} />

      {job.status !== 'CANCELLED' && (
        <ChangeOrdersList jobId={job.id} viewer="customer" currentMinor={job.agreedAmount} onReloadRequested={reload} />
      )}

      <View style={{ marginTop: 20, gap: 4 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>WHEN AND WHERE</Text>
        <Text variant="body" color={theme.colors.textPrimary}>{formatWindow(job.scheduledFrom, job.scheduledTo, job.whenOption, locale)}</Text>
        {job.location ? <Text variant="body" color={theme.colors.textPrimary}>{job.location}</Text> : null}
      </View>

      {worker ? (
        <TouchableOpacity onPress={() => router.push(`/worker/${worker.id}` as any)} accessibilityRole="button" accessibilityLabel={`View ${worker.user.name}'s profile`} activeOpacity={0.8}
          style={{ marginTop: 24, backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={worker.user.name} imageUrl={worker.user.profileImageUrl} size="lg" />
          <View style={{ marginStart: 14, flex: 1 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{worker.user.name}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{worker.isVerified ? 'ID checked' : 'Professional'}{worker.rating ? `  ·  ${worker.rating.toFixed(1)} ★` : ''}</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {job.status === 'COMPLETED' && job.assignedWorker && currentUser && !job.reviews?.some(r => r.reviewerId === currentUser.id) && (
        <ReviewForm 
          jobId={job.id} 
          targetId={job.assignedWorker.user.id} 
          targetName={job.assignedWorker.user.name} 
          onSubmitted={reload} 
        />
      )}

      <JobHistory events={job.events ?? []} viewer="customer" locale={locale} />
    </Screen>
  );
}
