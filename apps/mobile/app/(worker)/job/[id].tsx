import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { StatusTimeline } from '../../../src/components/ds/StatusTimeline';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { formatWindow, statusSentence, toPhase } from '../../../src/utils/jobStatus';
import { JobHistory, JobMedia } from '../../../src/components/ds/JobParts';
import { ChangeOrdersList } from '../../../src/components/ds/ChangeOrdersList';
import { ReviewForm } from '../../../src/components/ds/ReviewForm';
import { JobStepPhoto } from '../../../src/components/ds/JobStepPhoto';
import { ChangeOrderForm } from '../../../src/components/ds/ChangeOrderForm';
import { CallButton } from '../../../src/components/ds/CallButton';
import { SOS_COPY } from '../../../src/safety/copy';
import { MessageButton } from '../../../src/components/ds/MessageButton';
import { PriceForm } from '../../../src/components/ds/PriceForm';
import { useAppDispatch, useAppSelector } from '../../../src/hooks/useRedux';
import { startTracking, stopTracking } from '../../../src/store/trackingSlice';
import { formatMoney } from '../../../src/utils/money';
import { router } from 'expo-router';
import { useI18n } from '../../../src/hooks/useI18n';
import * as api from '../../../src/services/api';
import { useLiveReload } from '../../../src/hooks/useRealtime';

const PAYMENT_LABEL_WORKER: Record<string, string> = {
  MARKED_BY_WORKER: 'Cash marked. Waiting for the customer to confirm.',
  CONFIRMED: 'Cash payment confirmed',
  DISPUTED: 'The customer questioned this payment. Fixli support will look into it.',
  VOIDED: 'Payment not counted (resolved by support)',
};

export default function WorkerJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { locale } = useI18n();
  const { data: job, loading, error, reload, setData } = useApi(() => api.getJobView(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const me = useApi(api.getWorkerMe);
  const [editingPrice, setEditingPrice] = useState(false);
  const [creatingChangeOrder, setCreatingChangeOrder] = useState(false);
  const [photoStep, setPhotoStep] = useState<'before' | 'after' | null>(null);
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(state => state.auth.currentUser);
  
  // Booked by the customer, chosen someone else, cancelled: the screen follows along.
  useLiveReload(reload, ['job.updated', 'feed.updated'], (e) => e.data?.jobId === id);

  useEffect(() => {
    if (job?.status === 'EN_ROUTE' && me.data) {
      dispatch(startTracking({ workerId: me.data.id, jobId: job.id, customerLocation: job.latitude != null && job.longitude != null ? { latitude: job.latitude, longitude: job.longitude } : null }));
    } else {
      dispatch(stopTracking());
    }
  }, [job?.status, me.data?.id, job?.id, job?.latitude, job?.longitude, dispatch]);

  if (loading && !job) return <Screen title="Job" back><LoadingState /></Screen>;
  if (error && !job) return <Screen title="Job" back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!job) return null;

  const run = (fn: (id: string) => Promise<api.JobView>) => async () => {
    setBusy(true);
    setActionError(undefined);
    try { setData(await fn(job.id)); } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  const sendPrice = async (amount: number, eta?: number, note?: string) => {
    setBusy(true);
    setActionError(undefined);
    try { await api.submitOffer(job.id, amount, eta, note); setEditingPrice(false); await reload(); } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    setBusy(true);
    try { await api.withdrawOffer(job.id); await reload(); } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };
  const notForMe = async () => {
    setBusy(true);
    try { await api.notInterested(job.id); router.back(); } catch (e) { setActionError(friendlyError(e)); setBusy(false); }
  };
  
  const submitChangeOrder = async (v: { reason: string; addedScope: string; revisedPrice: number }) => {
    setBusy(true);
    setActionError(undefined);
    try {
      await api.createChangeOrder({ jobRequestId: job.id, ...v });
      setCreatingChangeOrder(false);
      await reload();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitStep = async (evidence: api.JobStepEvidence) => {
    setBusy(true);
    setActionError(undefined);
    try {
      setData(await (photoStep === 'before' ? api.startJob : api.finishJob)(job.id, evidence));
      setPhotoStep(null);
    } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  const offer = job.myOffer && job.myOffer.status === 'PENDING' ? job.myOffer : null;

  // One primary action per state; the server enforces the order.
  const action = photoStep || creatingChangeOrder ? undefined :
    job.status === 'AWAITING_WORKER' ? (
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button title="Decline" variant="secondary" size="lg" disabled={busy} onPress={run(api.declineJob)} /></View>
        <View style={{ flex: 1 }}><Button title="Accept job" variant="primary" size="lg" loading={busy} disabled={busy} onPress={run(api.acceptJob)} /></View>
      </View>
    ) : job.status === 'ACCEPTED' ? (
      <Button title="I'm on my way" variant="primary" size="lg" loading={busy} disabled={busy} onPress={run(api.enRouteJob)} />
    ) : job.status === 'EN_ROUTE' ? (
      <Button title="I've arrived" variant="primary" size="lg" loading={busy} disabled={busy} onPress={run(api.arriveJob)} />
    ) : job.status === 'ARRIVED' ? (
      <Button title="Start work" variant="primary" size="lg" disabled={busy} onPress={() => setPhotoStep('before')} />
    ) : job.status === 'IN_PROGRESS' ? (
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button title="Extra work" variant="secondary" size="lg" disabled={busy} onPress={() => setCreatingChangeOrder(true)} /></View>
        <View style={{ flex: 1 }}><Button title="Finish work" variant="primary" size="lg" disabled={busy} onPress={() => setPhotoStep('after')} /></View>
      </View>
    ) : job.status === 'AWAITING_CONFIRMATION' ? (
      <Text variant="body" color={theme.colors.textSecondary}>Waiting for the customer to confirm. It completes by itself if they don't respond.</Text>
    ) : undefined;

  const payment = job.payments?.[0];
  const needsPayment = (job.status === 'AWAITING_CONFIRMATION' || job.status === 'COMPLETED') && !payment && job.agreedAmount;

  const handleMarkCash = async () => {
    if (!job.agreedAmount) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.markCashReceived(job.id);
      await reload();
    } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Job" back footer={action} onRefresh={reload} refreshing={loading}>
      {job.isEmergency && job.status === 'AWAITING_WORKER' ? (
        <View style={{ backgroundColor: theme.colors.error, borderRadius: theme.borderRadius.lg, padding: 14, marginBottom: 12 }} accessibilityRole="alert">
          <Text variant="bodyLarge" weight="bold" color="#FFFFFF">{SOS_COPY.workerSosBanner(3)}</Text>
        </View>
      ) : null}
      <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{statusSentence(job.status, 'worker', job.customer?.name)}</Text>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, marginTop: 16, paddingVertical: 8 }}>
        <StatusTimeline currentPhase={toPhase(job.status)} />
      </View>
      <View style={{ marginTop: 24 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>WHAT NEEDS FIXING</Text>
        {job.title ? <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{job.title}</Text> : null}
        <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{job.description}</Text>
      </View>
      <JobMedia media={job.media ?? []} />
      
      {photoStep ? <JobStepPhoto kind={photoStep} busy={busy} onSubmit={submitStep} onCancel={() => setPhotoStep(null)} /> : null}
      {creatingChangeOrder ? (
        <ChangeOrderForm currentMinor={job.agreedAmount ?? null} currency={job.agreedCurrency ?? me.data?.currency ?? 'PKR'} locale={locale} busy={busy}
          onSubmit={submitChangeOrder} onCancel={() => setCreatingChangeOrder(false)} />
      ) : null}
      {['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(job.status) ? <MessageButton jobId={job.id} label="Message the customer" /> : null}
      {['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(job.status) ? <CallButton jobId={job.id} label="Call the customer" /> : null}

      {job.status !== 'CANCELLED' && (
        <ChangeOrdersList jobId={job.id} viewer="worker" currentMinor={job.agreedAmount} />
      )}

      <View style={{ marginTop: 20 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>WHEN</Text>
        <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{formatWindow(job.scheduledFrom, job.scheduledTo, job.whenOption, locale)}</Text>
      </View>
      <View style={{ marginTop: 20 }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>WHERE</Text>
        {/* The exact address is only sent once you are booked on the job. */}
        <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{job.location ?? [job.area, job.city].filter(Boolean).join(', ')}</Text>
        {!job.location ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 2 }}>You'll see the full address once you accept the job.</Text> : null}
      </View>
      {job.customer ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>CUSTOMER</Text>
          <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{job.customer.name}</Text>
        </View>
      ) : null}
      {job.isEmergency ? <Text variant="body" weight="bold" color={theme.colors.error} style={{ marginTop: 20 }}>Emergency</Text> : null}
      {actionError ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 16 }}>{actionError}</Text> : null}
      {job.status === 'MATCHES_FOUND' ? (
        <View style={{ marginTop: 28 }}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>Your price</Text>
          {offer && !editingPrice ? (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16 }}>
              <Text variant="h2" weight="extrabold" color={theme.colors.textPrimary}>{formatMoney(offer.amount, offer.currency, locale)}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 2 }}>Waiting for the customer · valid until {new Date(offer.expiresAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                <View style={{ flex: 1 }}><Button title="Withdraw" variant="secondary" disabled={busy} onPress={withdraw} /></View>
                <View style={{ flex: 1 }}><Button title="Change price" variant="primary" disabled={busy} onPress={() => setEditingPrice(true)} /></View>
              </View>
            </View>
          ) : me.data ? (
            <PriceForm
              currency={me.data.currency} usualMinor={me.data.pricingModel === 'HOURLY' ? me.data.hourlyRate : me.data.minimumCallOutFee}
              initialMinor={offer?.amount} initialEta={offer?.etaMinutes} locale={locale} busy={busy}
              submitLabel={offer ? 'Update price' : 'Send price'} onSubmit={sendPrice}
            />
          ) : null}
          {!offer ? <View style={{ marginTop: 12 }}><Button title="Not for me" variant="ghost" disabled={busy} onPress={notForMe} /></View> : null}
        </View>
      ) : null}
      {job.agreedAmount && job.agreedCurrency ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>Agreed price: {formatMoney(job.agreedAmount, job.agreedCurrency, locale)}</Text>
          {needsPayment ? (
            <View style={{ marginTop: 12 }}>
              <Button title={`I received ${formatMoney(job.agreedAmount, job.agreedCurrency ?? 'PKR', locale)} in cash`} variant="primary" loading={busy} disabled={busy} onPress={handleMarkCash} />
            </View>
          ) : payment ? (
            <Text variant="bodySmall" weight="bold" color={payment.status === 'CONFIRMED' ? theme.colors.success : payment.status === 'DISPUTED' ? theme.colors.error : theme.colors.warning} style={{ marginTop: 8 }}>
              {PAYMENT_LABEL_WORKER[payment.status] ?? 'Payment recorded'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {job.status === 'COMPLETED' && job.customer && currentUser && !job.reviews?.some(r => r.reviewerId === currentUser.id) && (
        <ReviewForm 
          jobId={job.id} 
          reviewing="customer"
          targetName={job.customer.name} 
          onSubmitted={reload} 
        />
      )}

      {['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(job.status) ? (
        <View style={{ marginTop: 16 }}><Button title="Emergency / I feel unsafe" variant="ghost" onPress={() => router.push({ pathname: '/sos', params: { jobId: job.id } } as any)} /></View>
      ) : null}
      <JobHistory events={job.events ?? []} viewer="worker" locale={locale} />
    </Screen>
  );
}
