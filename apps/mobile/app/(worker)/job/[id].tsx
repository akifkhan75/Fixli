import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { TextInput } from '../../../src/components/ds/TextInput';
import { PriceForm } from '../../../src/components/ds/PriceForm';
import { useAppDispatch, useAppSelector } from '../../../src/hooks/useRedux';
import { startTracking, stopTracking } from '../../../src/store/trackingSlice';
import { formatMoney } from '../../../src/utils/money';
import { router } from 'expo-router';
import { useI18n } from '../../../src/hooks/useI18n';
import * as api from '../../../src/services/api';
import { useLiveReload } from '../../../src/hooks/useRealtime';

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
  const [coReason, setCoReason] = useState('');
  const [coScope, setCoScope] = useState('');
  const [shutoff, setShutoff] = useState(false);
  const [ppe, setPpe] = useState(false);
  const [coPriceStr, setCoPriceStr] = useState('');
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(state => state.auth.currentUser);
  
  // Booked by the customer, chosen someone else, cancelled: the screen follows along.
  useLiveReload(reload, ['job.updated', 'feed.updated'], (e) => e.data?.jobId === id);

  useEffect(() => {
    if (job?.status === 'EN_ROUTE' && me.data) {
      dispatch(startTracking({ workerId: me.data.id, jobId: job.id, customerLocation: { latitude: job.latitude || 0, longitude: job.longitude || 0 } }));
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
  
  const submitChangeOrder = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      await api.createChangeOrder({
        jobRequestId: job.id,
        reason: coReason,
        addedScope: coScope,
        revisedPrice: parseInt(coPriceStr, 10),
      });
      setCreatingChangeOrder(false);
      setCoReason('');
      setCoScope('');
      setCoPriceStr('');
      await reload();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const offer = job.myOffer && job.myOffer.status === 'PENDING' ? job.myOffer : null;

  // One primary action per state; the server enforces the order.
  const action =
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
      <Button
        title="Start work" variant="primary" size="lg" loading={busy}
        disabled={busy || (job.isEmergency && !(shutoff && ppe))}
        onPress={run((jobId) => api.startJob(jobId, undefined, job.isEmergency ? { shutoffVerified: shutoff, protectiveEquipment: ppe } : undefined))}
      />
    ) : job.status === 'IN_PROGRESS' ? (
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button title="Change Order" variant="secondary" size="lg" disabled={busy} onPress={() => setCreatingChangeOrder(true)} /></View>
        <View style={{ flex: 1 }}><Button title="Finish work" variant="primary" size="lg" loading={busy} disabled={busy} onPress={run(api.finishJob)} /></View>
      </View>
    ) : undefined;

  const payment = job.payments?.[0];
  const needsPayment = (job.status === 'AWAITING_CONFIRMATION' || job.status === 'COMPLETED') && !payment && job.agreedAmount;

  const handleMarkCash = async () => {
    if (!job.agreedAmount) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.markCashReceived(job.id, job.agreedAmount);
      await reload();
    } catch (e) { setActionError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Job" back footer={action} onRefresh={reload} refreshing={loading}>
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
      
      {creatingChangeOrder && (
        <View style={{ marginTop: 20, backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg }}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>New Change Order</Text>
          <View style={{ gap: 12 }}>
            <TextInput label="Reason for change" value={coReason} onChangeText={setCoReason} placeholder="e.g. Found water damage" />
            <TextInput label="Added scope" value={coScope} onChangeText={setCoScope} placeholder="e.g. Replace drywall" />
            <TextInput label="New Total Price (Minor units)" value={coPriceStr} onChangeText={setCoPriceStr} keyboardType="numeric" />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" disabled={busy} onPress={() => setCreatingChangeOrder(false)} /></View>
              <View style={{ flex: 1 }}><Button title="Submit" variant="primary" loading={busy} disabled={busy || !coReason || !coScope || !coPriceStr} onPress={submitChangeOrder} /></View>
            </View>
          </View>
        </View>
      )}

      {job.status !== 'CANCELLED' && (
        <ChangeOrdersList jobId={job.id} viewer="worker" />
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
      {job.isEmergency && job.status === 'ARRIVED' ? (
        <View style={{ marginTop: 12, padding: 14, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface }}>
          <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>Safety check before you start</Text>
          {([
            { on: shutoff, set: setShutoff, label: 'Main power, gas and water shut-off found and verified OFF' },
            { on: ppe, set: setPpe, label: 'I am wearing protective equipment' },
          ]).map((c) => (
            <TouchableOpacity key={c.label} onPress={() => c.set(!c.on)} accessibilityRole="checkbox" accessibilityState={{ checked: c.on }} accessibilityLabel={c.label}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <Ionicons name={c.on ? 'checkbox' : 'square-outline'} size={26} color={c.on ? theme.colors.success : theme.colors.textTertiary} />
              <Text variant="body" color={theme.colors.textPrimary} style={{ flex: 1 }}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
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
              <Button title="Mark Cash Received" variant="primary" loading={busy} disabled={busy} onPress={handleMarkCash} />
            </View>
          ) : payment ? (
            <Text variant="bodySmall" weight="bold" color={payment.status === 'CONFIRMED' ? theme.colors.success : theme.colors.warning} style={{ marginTop: 8 }}>
              Payment: {payment.status.replace(/_/g, ' ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {job.status === 'COMPLETED' && job.customer && currentUser && !job.reviews?.some(r => r.reviewerId === currentUser.id) && (
        <ReviewForm 
          jobId={job.id} 
          targetId={job.customer.id} 
          targetName={job.customer.name} 
          onSubmitted={reload} 
        />
      )}

      {job.customer && ['ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(job.status) ? (
        <View style={{ marginTop: 16 }}>
          <Button title="Report a problem" variant="secondary" onPress={() => router.push({ pathname: '/report-problem', params: { jobId: job.id } } as any)} />
        </View>
      ) : null}

      <JobHistory events={job.events ?? []} viewer="worker" locale={locale} />
    </Screen>
  );
}
