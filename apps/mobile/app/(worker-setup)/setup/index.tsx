import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../src/hooks/useTheme';
import { useI18n } from '../../../src/hooks/useI18n';
import { friendlyError } from '../../../src/hooks/useApi';
import { useWorkerMe } from '../../../src/hooks/useWorkerMe';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { Card } from '../../../src/components/ds/Card';
import { GroupedList } from '../../../src/components/ds/GroupedList';
import { StepHeader } from '../../../src/components/ds/StepHeader';
import { SpeakButton } from '../../../src/components/ds/SpeakButton';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { Entrance } from '../../../src/components/motion/Entrance';
import { ProgressBar } from '../../../src/components/motion/ProgressBar';
import { SuccessCheck } from '../../../src/components/motion/SuccessCheck';
import { PulseRings } from '../../../src/components/motion/PulseRings';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

const STEPS = (): { id: api.OnboardingStep; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] => ([
  { id: 'skills', label: t('workerSetup.whatYouFix'), hint: t('workerSetup.chooseYourTrades'), icon: 'construct' },
  { id: 'area', label: t('workerSetupArea.whereYouWork'), hint: t('workerSetup.yourBaseAndHow'), icon: 'location' },
  { id: 'hours', label: t('workerSetupHours.workingHours'), hint: t('workerSetup.daysAndTimesYou'), icon: 'time' },
  { id: 'pricing', label: t('workerSetup.yourPrices'), hint: t('workerSetup.callOutFeeOr'), icon: 'cash' },
  { id: 'documents', label: t('workerAccount.idAndSelfie'), hint: t('workerSetup.soCustomersCanTrust'), icon: 'id-card' },
]);

export default function SetupScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { data: me, loading, error, reload, setData } = useWorkerMe();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  if (loading && !me) return <Screen title={t('workerSetup.setUpYourProfile')} back><LoadingState /></Screen>;
  if (error && !me) return <Screen title={t('workerSetup.setUpYourProfile')} back><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!me) return null;

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      setData(await api.submitWorkerForReview());
    } catch (e) {
      setSubmitError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const steps = STEPS();
  const locked = me.activationStatus === 'PENDING_REVIEW' || me.activationStatus === 'ACTIVE';
  const rejectedDoc = me.verifications.find((v) => v.status === 'REJECTED' || v.status === 'NEEDS_INFO');
  const next = steps.find((s) => !me.onboarding.steps[s.id]);
  const done = steps.filter((s) => me.onboarding.steps[s.id]).length;

  // One obvious button: the next thing to do.
  const footer = locked ? undefined : me.onboarding.complete
    ? <Button title={t('workerSetup.sendForReview')} size="lg" variant="accent" loading={submitting} disabled={submitting} onPress={submit} />
    : next ? <Button title={t('workerSetup.next', { step: next.label })} size="lg" onPress={() => router.push(`/setup/${next.id}` as any)} /> : undefined;

  return (
    <Screen title={t('workerSetup.setUpYourProfile')} back onRefresh={reload} refreshing={loading} footer={footer}>
      {me.activationStatus === 'PENDING_REVIEW' ? (
        <View style={{ alignItems: 'center', marginBottom: theme.spacing.xl }}>
          <PulseRings icon="hourglass" label={t('workerSetup.thankYouOurTeam')} />
          <Text variant="bodyLarge" weight="semibold" align="center">{t('workerSetup.thankYouOurTeam')}</Text>
        </View>
      ) : me.activationStatus === 'ACTIVE' ? (
        <View style={{ alignItems: 'center', marginBottom: theme.spacing.xl, gap: 8 }}>
          <SuccessCheck label={t('workerSetup.youAreApprovedYou')} />
          <Text variant="bodyLarge" weight="semibold" align="center" color={theme.colors.successText}>{t('workerSetup.youAreApprovedYou')}</Text>
        </View>
      ) : (
        <>
          <StepHeader question={t('workerSetup.fiveSteps')} help={t('workerSetup.fiveStepsHelp')} />
          <ProgressBar value={done / steps.length} height={14} color={theme.colors.success} label={t('workerSetup.percentDone', { percent: me.onboarding.percent })} />
          <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginTop: 6, marginBottom: theme.spacing.lg }}>{t('workerSetup.stepsDone', { done, total: steps.length })}</Text>
        </>
      )}

      {rejectedDoc ? (
        <Card tint={theme.colors.errorSoft} onPress={() => router.push('/setup/documents' as any)} style={{ marginBottom: 16 }}>
          <Text variant="body" weight="semibold" color={theme.colors.errorText}>{rejectedDoc.type === 'ID' ? t('workerSetup.fixId') : t('workerSetup.fixSelfie')}</Text>
          {rejectedDoc.reason ? <Text variant="bodySmall" style={{ marginTop: 4 }}>{rejectedDoc.reason}</Text> : null}
        </Card>
      ) : null}

      {steps.map((s, i) => {
        const complete = me.onboarding.steps[s.id];
        const isNext = !locked && next?.id === s.id;
        return (
          <Entrance key={s.id} index={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.spacing.md }}>
            <Card onPress={() => router.push(`/setup/${s.id}` as any)} highlight={isNext ? theme.colors.primary : undefined} tint={complete ? theme.colors.successSoft : undefined}
              accessibilityLabel={`${s.label}. ${complete ? t('workerSetup.stepDone') : s.hint}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: complete ? theme.colors.success : isNext ? theme.colors.primary : theme.colors.surfaceElevated }}>
                <Ionicons name={complete ? 'checkmark' : s.icon} size={28} color={complete || isNext ? theme.colors.onPrimary : theme.colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyLarge" weight="bold">{i + 1}. {s.label}</Text>
                <Text variant="bodySmall" color={theme.colors.textSecondary}>{complete ? t('workerSetup.stepDone') : s.hint}</Text>
              </View>
            </Card>
            <SpeakButton text={`${s.label}. ${s.hint}`} />
          </Entrance>
        );
      })}

      <View style={{ marginTop: theme.spacing.xl }}>
        <GroupedList title={t('workerSetup.makeYourProfileStronger')} items={[
          { id: 'about', label: t('workerAccount.aboutYouAndYour'), icon: 'person-outline', onPress: () => router.push('/setup/about' as any) },
          { id: 'tools', label: t('workerAccount.toolsYouBring'), icon: 'build-outline', value: me.equipment?.length ? String(me.equipment.length) : undefined, onPress: () => router.push('/setup/tools' as any) },
          { id: 'portfolio', label: t('workerAccount.photosOfYourPast'), icon: 'images-outline', value: me.portfolio.length ? String(me.portfolio.length) : undefined, onPress: () => router.push('/setup/portfolio' as any) },
        ]} />
      </View>
      {submitError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{submitError}</Text> : null}
    </Screen>
  );
}
