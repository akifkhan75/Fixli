import { analytics } from '../../../src/services/analytics';
import { StaleNote } from '../../../src/components/ds/StaleNote';
import React, { useEffect, useRef, useState } from 'react';
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
import { CashConfirmCard } from '../../../src/components/ds/CashConfirmCard';
import { ReportProblem } from '../../../src/components/ds/ReportProblem';
import { FavoriteHeart } from '../../../src/components/ds/FavoriteHeart';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { OfferCard } from '../../../src/components/ds/OfferCard';
import MapView, { Marker } from 'react-native-maps';
import { useAppDispatch, useAppSelector } from '../../../src/hooks/useRedux';
import { useWorkerLiveLocation } from '../../../src/hooks/useWorkerLiveLocation';
import { CallButton } from '../../../src/components/ds/CallButton';
import { MessageButton } from '../../../src/components/ds/MessageButton';
import { formatMoney } from '../../../src/utils/money';
import { CANCEL_REASON_LABEL, formatWindow, statusSentence, toPhase } from '../../../src/utils/jobStatus';
import { humanize, localizedName } from '../../../src/utils/catalog';
import * as api from '../../../src/services/api';
import { useLiveReload } from '../../../src/hooks/useRealtime';
import { t, tn } from '../../../src/i18n';

// Job status, prices, extra-work requests and the professional's position update live.
export default function CustomerJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { locale } = useI18n();
  const { data: job, loading, error, reload, setData, staleAt } = useApi(() => api.getJobView(id), [id], { cacheKey: `job:${id}` });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const open = job?.status === 'MATCHES_FOUND';
  const offers = useApi(() => (open ? api.listOffers(id) : Promise.resolve([])), [id, open]);
  const [confirming, setConfirming] = useState<api.OfferCard | null>(null);
  const viewedOffers = useRef(false);
  useEffect(() => { if (offers.data?.length && !viewedOffers.current) { viewedOffers.current = true; void analytics.track('offer_viewed'); } }, [offers.data]);

  const mine = (e: { data?: { jobId?: string } }) => e.data?.jobId === id;
  useLiveReload(reload, ['job.updated'], mine);
  useLiveReload(offers.reload, ['offers.updated'], mine, { enabled: open, fallbackMs: 60_000 });
  useEffect(() => { if (confirming && !offers.data?.some((o) => o.id === confirming.id)) setConfirming(null); }, [offers.data, confirming]);

  const currentUser = useAppSelector(state => state.auth.currentUser);
  const live = useWorkerLiveLocation(id, job?.status === 'EN_ROUTE');

  if (loading && !job) return <Screen title={t('customerJob.yourRequest')} back><LoadingState /></Screen>;
  if (error && !job) return <Screen title={t('customerJob.yourRequest')} back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!job) return null;

  const worker = job.assignedWorker;
  const cancellable = ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED'].includes(job.status);
  const catName = job.category ? localizedName({ name: job.category.translations?.en?.name ?? humanize(job.category.name), translations: job.category.translations }, locale) : '';

  const book = async (offer: api.OfferCard) => {
    setBusy(true);
    setActionError(undefined);
    try {
      await api.acceptOffer(offer.id);
      void analytics.track('offer_chosen');
      setConfirming(null);
      await reload();
    } catch (e) {
      setActionError(friendlyError(e));
      await offers.reload();
    } finally { setBusy(false); }
  };

  const confirmCancel = async () => {
    if (!reason[0]) { setActionError(t('customerJob.pleaseChooseAReason')); return; }
    setBusy(true);
    setActionError(undefined);
    try {
      setData(await api.cancelJobWithReason(job.id, reason[0] as api.CancelReason, note.trim() || undefined));
      setCancelling(false);
    } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  const payment = job.payments?.[0] as api.PaymentView | undefined;
  const bookAgain = () => { void analytics.track('rebook_started'); router.push({
    pathname: '/(customer)/request-service',
    params: { categoryId: job.category?.id, issue: job.issueCodes?.[0], ...(worker ? { workerId: worker.id } : {}) },
  } as any); };

  const footer = !cancellable && job.status !== 'AWAITING_CONFIRMATION' ? undefined : job.status === 'AWAITING_CONFIRMATION' ? (
    <Button title={t('customerJob.confirmWorkIsDone')} variant="primary" size="lg" loading={busy} disabled={busy} onPress={async () => {
      setBusy(true);
      try {
        setData(await api.confirmJob(job.id));
        void analytics.track('job_status_changed', { status: 'COMPLETED', side: 'customer' });
      } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
    }} />
  ) : cancelling ? (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ flex: 1 }}><Button title={t('customerJob.keepRequest')} variant="secondary" size="lg" disabled={busy} onPress={() => setCancelling(false)} /></View>
      <View style={{ flex: 1 }}><Button title={t('customerJob.cancelIt')} variant="danger" size="lg" loading={busy} disabled={busy} onPress={confirmCancel} /></View>
    </View>
  ) : <Button title={t('customerJob.cancelThisRequest')} variant="secondary" size="lg" onPress={() => { setCancelling(true); setActionError(undefined); }} />;

  return (
    <Screen title={t('customerJob.yourRequest')} back onRefresh={reload} refreshing={loading} footer={footer}>
      <StaleNote at={staleAt} />
      <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{statusSentence(job.status, 'customer', worker?.user.name)}</Text>
      {job.status === 'MATCHES_FOUND' ? (
        <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>
          {job.notifiedCount
            ? tn('customerJob.toldProfessionals', job.notifiedCount)
            : job.matchRound && job.matchRound >= 2
              ? t('customerJob.noProfessionalsAreFree')
              : t('customerJob.lookingForProfessionalsNear')}
        </Text>
      ) : null}
      
      {job.agreedAmount && job.agreedCurrency && job.status !== 'CANCELLED' ? (
        <View style={{ marginTop: 6 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{t('customerJob.agreedPrice', { price: formatMoney(job.agreedAmount, job.agreedCurrency, locale) })}</Text>
          {payment?.status === 'MARKED_BY_WORKER' ? <CashConfirmCard payment={payment} locale={locale} onDone={reload} /> : null}
          {payment && payment.status !== 'MARKED_BY_WORKER' ? (
            <Text variant="bodySmall" weight="bold" color={payment.status === 'CONFIRMED' ? theme.colors.successText : theme.colors.warningText} style={{ marginTop: 8 }}>
              {payment.status === 'CONFIRMED' ? t('customerJob.paidInCash', { amount: formatMoney(payment.amount, payment.currency, locale) }) : payment.status === 'DISPUTED' ? t('customerJob.youQuestionedThisPayment') : t('customerJob.paymentClosedBySupport')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {open ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>{t('customerJob.pricesFromProfessionals')}</Text>
          {confirming ? (
            <View style={{ backgroundColor: theme.colors.primary + '12', borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 14 }} accessibilityRole="alert">
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>
                {t('customerJob.bookFor', { name: confirming.worker.name, price: formatMoney(confirming.amount, confirming.currency, locale) })}
              </Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>{t('customerJob.theyWillGetYour')}</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <View style={{ flex: 1 }}><Button title={t('authSignup.back')} variant="secondary" disabled={busy} onPress={() => setConfirming(null)} /></View>
                <View style={{ flex: 1 }}><Button title={t('customerJob.book')} variant="primary" loading={busy} disabled={busy} onPress={() => book(confirming)} /></View>
              </View>
            </View>
          ) : null}
          {offers.data?.length ? offers.data.map((o) => (
            <OfferCard key={o.id} offer={o} locale={locale} onChoose={() => setConfirming(o)} disabled={busy || !!confirming} />
          )) : offers.loading && !offers.data ? <LoadingState message={t('customerJob.checkingForPrices')} /> : (
            <Text variant="body" color={theme.colors.textSecondary}>{t('customerJob.noPricesYetThis')}</Text>
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
            {live?.etaMinutes != null ? t('customerJob.aboutMinAway', { etaMinutes: live.etaMinutes }) : t('customerJob.onTheWay')}
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
                {job.latitude != null && job.longitude != null ? <Marker coordinate={{ latitude: job.latitude, longitude: job.longitude }} title={t('customerJob.yourAddress')} pinColor="blue" /> : null}
                {live ? <Marker coordinate={{ latitude: live.latitude, longitude: live.longitude }} title={t('customerJob.professional')} pinColor="red" /> : null}
              </MapView>
            </View>
          ) : null}
          {!live ? <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginTop: 6 }}>{t('customerJob.waitingForTheirLocation')}</Text> : null}
        </View>
      ) : null}
      {worker && ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(job.status) ? <MessageButton jobId={job.id} label={t('customerJob.messageTheProfessional')} /> : null}
      {worker && ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(job.status) ? <CallButton jobId={job.id} label={t('customerJob.callTheProfessional')} /> : null}

      {cancelling ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 10 }}>{t('customerJob.whyAreYouCancelling')}</Text>
          <ChipChoice options={Object.entries(CANCEL_REASON_LABEL).map(([id, label]) => ({ id, label }))} selectedIds={reason} onChange={setReason} />
          <View style={{ marginTop: 12 }}><TextInput label={t('customerJob.anythingElseOptional')} value={note} onChangeText={setNote} maxLength={300} /></View>
        </View>
      ) : null}
      {actionError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 12 }}>{actionError}</Text> : null}

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
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>{t('customerJob.whenAndWhere')}</Text>
        <Text variant="body" color={theme.colors.textPrimary}>{formatWindow(job.scheduledFrom, job.scheduledTo, job.whenOption, locale)}</Text>
        {job.location ? <Text variant="body" color={theme.colors.textPrimary}>{job.location}</Text> : null}
      </View>

      {worker ? (
        <TouchableOpacity onPress={() => router.push(`/worker/${worker.id}` as any)} accessibilityRole="button" accessibilityLabel={t('customerJob.viewSProfile', { name: worker.user.name })} activeOpacity={0.8}
          style={{ marginTop: 24, backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={worker.user.name} imageUrl={worker.user.profileImageUrl} size="lg" />
          <View style={{ marginStart: 14, flex: 1 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{worker.user.name}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{worker.isVerified ? t('customerJob.idChecked') : t('customerJob.professional')}{worker.rating ? `  ·  ${worker.rating.toFixed(1)} ★` : ''}</Text>
          </View>
          <FavoriteHeart workerId={worker.id} />
        </TouchableOpacity>
      ) : null}

      {['AWAITING_CONFIRMATION', 'COMPLETED'].includes(job.status) ? <ReportProblem jobId={job.id} onDone={reload} /> : null}
      {job.status === 'COMPLETED' ? (
        <View style={{ marginTop: 12 }}><Button title={worker ? t('customerJob.bookAgain', { name: worker.user.name.split(' ')[0] }) : t('customerJob.bookAgain2')} variant="secondary" onPress={bookAgain} /></View>
      ) : null}
      {job.status === 'COMPLETED' && job.assignedWorker && currentUser && !job.reviews?.some(r => r.reviewerId === currentUser.id) && (
        <ReviewForm 
          jobId={job.id} 
          reviewing="worker"
          targetName={job.assignedWorker.user.name} 
          onSubmitted={reload} 
        />
      )}

      {['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(job.status) ? (
        <View style={{ marginTop: 16 }}><Button title={t('customerJob.emergencyIFeelUnsafe')} variant="ghost" onPress={() => router.push({ pathname: '/sos', params: { jobId: job.id } } as any)} /></View>
      ) : null}
      <JobHistory events={job.events ?? []} viewer="customer" locale={locale} />
    </Screen>
  );
}
