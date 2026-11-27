import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAudioPlayer } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { routes } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { useApi, friendlyError } from '../../hooks/useApi';
import { useLiveReload } from '../../hooks/useRealtime';
import { useAppSelector } from '../../hooks/useRedux';
import { selectCurrentUser } from '../../store/authSlice';
import * as api from '../../services/api';
import { catalogName } from '../../utils/catalog';
import { formatMoney } from '../../utils/money';
import { projectSentence, PROPERTY_TYPES, START_WHEN, workTypeLabel } from '../../utils/projectStatus';
import { Screen } from '../ds/Screen';
import { Text } from '../ds/Text';
import { Button } from '../ds/Button';
import { Card } from '../ds/Card';
import { ConfirmButton } from '../ds/ConfirmButton';
import { PhotoStrip } from '../ds/PhotoStrip';
import { ReviewForm } from '../ds/ReviewForm';
import { EmptyState, ErrorState, LoadingState } from '../ds/EmptyState';
import { StaleNote } from '../ds/StaleNote';
import { PulseRings } from '../motion/PulseRings';
import { ProgressBar } from '../motion/ProgressBar';
import { SuccessCheck } from '../motion/SuccessCheck';
import { BidCard } from './BidCard';
import { BidForm } from './BidForm';
import { StageCard } from './StageCard';
import { Materials } from './Materials';
import { Visits } from './Visits';
import { budgetText } from './ProjectCard';

/** One project, for whoever is looking: the customer, the hired professional, or one pricing it. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { t, locale } = useI18n();
  const user = useAppSelector(selectCurrentUser);
  const { data: project, loading, error, reload, staleAt } = useApi(() => api.getProject(id), [id], { cacheKey: `project:${user?.id}:${id}` });
  const wantsBids = project?.viewer === 'customer' && project.status === 'OPEN';
  const bids = useApi(() => (wantsBids ? api.listProjectBids(id) : Promise.resolve([])), [id, wantsBids]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  const reloadAll = useCallback(async () => { await Promise.all([reload(), bids.reload()]); }, [reload, bids.reload]);
  useFocusEffect(useCallback(() => { void reloadAll(); }, [reloadAll]));
  useLiveReload(reloadAll, ['project.updated'], (e) => e.data?.projectId === id);
  const player = useAudioPlayer(project?.audioUrl ?? null);

  const back = t('project.title');
  if (loading && !project) return <Screen title={back} back><LoadingState /></Screen>;
  if (error && !project) return <Screen title={back} back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!project) return null;

  const isCustomer = project.viewer === 'customer';
  const side = isCustomer ? 'customer' : 'worker';
  const money = (v: number) => formatMoney(v, project.currency, locale);
  const counted = project.milestones.filter((m) => m.status !== 'CANCELLED');
  const done = counted.filter((m) => m.status === 'RELEASED').length;
  const currentStage = project.milestones.find((m) => m.status !== 'RELEASED' && m.status !== 'CANCELLED');
  const hired = !!project.awardedWorker && project.viewer !== 'candidate';
  const busyStage = project.milestones.some((m) => ['IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED'].includes(m.status));
  const canCancel = !busyStage && (isCustomer ? ['DRAFT', 'OPEN', 'AWARDED', 'IN_PROGRESS'].includes(project.status) : project.viewer === 'hired' && project.status === 'AWARDED');

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(undefined);
    try { await work(); await reloadAll(); }
    catch (e) { setActionError(friendlyError(e)); await reloadAll(); }
    finally { setBusy(false); }
  };
  const chat = () => run(async () => { const c = await api.conversationForProject(project.id); router.push(routes.thread(c.id) as any); });

  return (
    <Screen title={back} back onRefresh={reloadAll} refreshing={loading && !!project}>
      <StaleNote at={staleAt} />
      {project.status === 'COMPLETED' ? <View style={{ alignItems: 'center', marginBottom: 12 }}><SuccessCheck label={projectSentence(project.status, side)} /></View> : null}
      <Text variant="h2" weight="bold">{project.title}</Text>
      <Text variant="body" weight="semibold" color={theme.colors.primaryText} style={{ marginTop: 4 }}>{projectSentence(project.status, side)}</Text>

      {counted.length ? (
        <View style={{ marginTop: theme.spacing.lg, gap: 6 }}>
          <ProgressBar value={done / counted.length} height={10} color={theme.colors.success} label={t('project.stagesDone', { done, total: counted.length })} />
          <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('project.stagesDone', { done, total: counted.length })}{project.agreedAmount ? ` · ${t('customerJob.agreedPrice', { price: money(project.agreedAmount) })}` : ''}</Text>
        </View>
      ) : null}

      {hired && isCustomer && project.awardedWorker ? (
        <Card onPress={() => router.push(`/worker/${project.awardedWorker!.id}` as any)} style={{ marginTop: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name="person-circle" size={40} color={theme.colors.primaryText} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyLarge" weight="bold">{project.awardedWorker.businessName ?? project.awardedWorker.user.name}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{project.paymentMode === 'ESCROW' ? t('project.payCard') : t('project.payDirect')}</Text>
          </View>
        </Card>
      ) : null}
      {hired ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Button title={isCustomer ? t('customerJob.messageTheProfessional') : t('project.messageCustomer')} variant="tinted" size="lg" disabled={busy} onPress={chat} leftIcon={<Ionicons name="chatbubbles" size={20} color={theme.colors.primaryText} />} />
        </View>
      ) : null}

      {project.milestones.length && project.viewer !== 'candidate' ? (
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('project.stages')}</Text>
          {project.milestones.map((m, i) => <StageCard key={m.id} project={project} stage={m} current={currentStage?.id === m.id} onChanged={reloadAll} index={i} />)}
        </View>
      ) : null}

      {wantsBids ? (
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('customerJob.pricesFromProfessionals')}</Text>
          {bids.loading && !bids.data ? <LoadingState /> : bids.error && !bids.data ? <ErrorState message={bids.error} onRetry={bids.reload} /> : bids.data?.length ? (
            bids.data.map((b, i) => <BidCard key={b.id} index={i} bid={b} cardAvailable={project.cardAvailable} busy={busy} onHire={(mode) => run(() => api.awardProject(project.id, b.id, mode))} />)
          ) : (
            <View style={{ alignItems: 'center' }}>
              <PulseRings icon="search" label={t('project.waitingPrices')} />
              <Text variant="body" align="center" color={theme.colors.textSecondary}>{t('project.waitingPrices')}</Text>
            </View>
          )}
        </View>
      ) : null}

      {project.viewer === 'candidate' ? (
        project.status === 'OPEN' ? (
          <View style={{ marginTop: theme.spacing['2xl'] }}>
            {project.myBid?.status === 'PENDING' ? (
              <Card tint={theme.colors.successSoft} style={{ marginBottom: theme.spacing.lg }}>
                <Text variant="bodyLarge" weight="bold" color={theme.colors.successText}>{t('workerJobs.yourPriceWaiting', { price: money(project.myBid.totalAmount) })}</Text>
              </Card>
            ) : null}
            <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('workerJobs.sendYourPrice')}</Text>
            <BidForm project={project} busy={busy} onSubmit={(bid) => run(() => api.sendProjectBid(project.id, bid))} />
            <View style={{ marginTop: theme.spacing.md }}>
              <ConfirmButton title={t('workerJob.notForMe')} question={t('project.declineQuestion')} variant="ghost" busy={busy}
                onConfirm={() => run(async () => { await api.declineProject(project.id); router.back(); })} />
            </View>
          </View>
        ) : <EmptyState icon="lock-closed-outline" title={t('project.closed')} />
      ) : null}

      <View style={{ marginTop: theme.spacing['2xl'] }}>
        <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.sm }}>{t('project.details')}</Text>
        <Card style={{ gap: 6 }}>
          <Text variant="body" weight="semibold">{catalogName(project.category, locale)} · {workTypeLabel(project.workType)} · {PROPERTY_TYPES().find((p) => p.id === project.propertyType)?.label}</Text>
          {project.description ? <Text variant="body">{project.description}</Text> : null}
          {project.audioTranscript ? <Text variant="body">"{project.audioTranscript}"</Text> : null}
          {project.audioUrl ? <Button title={t('voiceField.playYourVoiceNote')} variant="secondary" onPress={() => { player.seekTo(0); player.play(); }} leftIcon={<Ionicons name="play" size={20} color={theme.colors.textPrimary} />} /> : null}
          <PhotoStrip photos={project.photos.map((uri) => ({ id: uri, uri }))} label={t('project.photo')} />
          {!project.agreedAmount ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('project.budget')}: {budgetText(project.budgetMin, project.budgetMax, project.currency, locale, t('project.budgetOpen'))}</Text> : null}
          <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('project.startWhen')}: {START_WHEN().find((s) => s.id === project.startWhen)?.label}</Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>{project.location ?? [project.area, project.city].filter(Boolean).join(', ')}{project.distanceKm != null && !project.location ? ` · ${t('offerCard.kmAway', { km: project.distanceKm })}` : ''}</Text>
          {project.viewer === 'hired' ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{project.customer.name}</Text> : null}
          {project.viewer === 'candidate' ? <Text variant="caption" color={theme.colors.textTertiary}>{t('project.addressLater')}</Text> : null}
        </Card>
      </View>

      {project.viewer !== 'candidate' && project.status !== 'DRAFT' && project.status !== 'OPEN' ? (
        <>
          <Visits project={project} onChanged={reloadAll} />
          <Materials project={project} userId={user?.id ?? ''} onChanged={reloadAll} />
        </>
      ) : null}

      {project.status === 'COMPLETED' && project.viewer !== 'candidate' && user && !project.reviews.some((r) => r.reviewerId === user.id) ? (
        <ReviewForm projectId={project.id} reviewing={isCustomer ? 'worker' : 'customer'}
          targetName={isCustomer ? project.awardedWorker?.user.name ?? '' : project.customer.name} onSubmitted={reloadAll} />
      ) : null}

      {actionError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 12 }}>{actionError}</Text> : null}
      {canCancel ? (
        <View style={{ marginTop: theme.spacing['2xl'] }}>
          <ConfirmButton title={t('project.cancel')} question={t('project.cancelQuestion')} confirmTitle={t('customerJob.cancelIt')} variant="danger" busy={busy} onConfirm={() => run(() => api.cancelProject(project.id))} />
        </View>
      ) : null}
    </Screen>
  );
}
