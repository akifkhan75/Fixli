import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { friendlyError } from '../../../src/hooks/useApi';
import { useWorkerMe } from '../../../src/hooks/useWorkerMe';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { GroupedList } from '../../../src/components/ds/GroupedList';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import * as api from '../../../src/services/api';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../../src/i18n';

const STEPS = (): { id: api.OnboardingStep; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; path: string }[] => ([
  { id: 'skills', label: t('workerSetup.whatYouFix'), hint: t('workerSetup.chooseYourTrades'), icon: 'construct-outline', path: '/setup/skills' },
  { id: 'area', label: t('workerSetupArea.whereYouWork'), hint: t('workerSetup.yourBaseAndHow'), icon: 'location-outline', path: '/setup/area' },
  { id: 'hours', label: t('workerSetupHours.workingHours'), hint: t('workerSetup.daysAndTimesYou'), icon: 'time-outline', path: '/setup/hours' },
  { id: 'pricing', label: t('workerSetup.yourPrices'), hint: t('workerSetup.callOutFeeOr'), icon: 'cash-outline', path: '/setup/pricing' },
  { id: 'documents', label: t('workerAccount.idAndSelfie'), hint: t('workerSetup.soCustomersCanTrust'), icon: 'id-card-outline', path: '/setup/documents' },
]);

export default function SetupScreen() {
  const theme = useTheme();
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

  const locked = me.activationStatus === 'PENDING_REVIEW' || me.activationStatus === 'ACTIVE';
  const rejectedDoc = me.verifications.find((v) => v.status === 'REJECTED' || v.status === 'NEEDS_INFO');

  return (
    <Screen
      title={t('workerSetup.setUpYourProfile')}
      back
      onRefresh={reload}
      refreshing={loading}
      footer={!locked ? <Button title={t('workerSetup.sendForReview')} size="lg" variant="primary" loading={submitting} disabled={!me.onboarding.complete || submitting} onPress={submit} /> : undefined}
    >
      <Text variant="bodyLarge" color={theme.colors.textPrimary}>{t('workerSetup.percentDone', { percent: me.onboarding.percent })}</Text>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.border, marginVertical: 12, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: me.onboarding.percent }}>
        <View style={{ height: 8, width: `${me.onboarding.percent}%`, backgroundColor: theme.colors.primary }} />
      </View>

      {me.activationStatus === 'PENDING_REVIEW' ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 16 }}>{t('workerSetup.thankYouOurTeam')}</Text> : null}
      {me.activationStatus === 'ACTIVE' ? <Text variant="body" color={theme.colors.successText} style={{ marginBottom: 16 }}>{t('workerSetup.youAreApprovedYou')}</Text> : null}
      {rejectedDoc ? (
        <View style={{ backgroundColor: theme.colors.error + '15', borderRadius: 12, padding: 14, marginBottom: 16 }} accessibilityRole="alert">
          <Text variant="body" weight="semibold" color={theme.colors.errorText}>{rejectedDoc.type === 'ID' ? t('workerSetup.fixId') : t('workerSetup.fixSelfie')}</Text>
          {rejectedDoc.reason ? <Text variant="bodySmall" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>{rejectedDoc.reason}</Text> : null}
        </View>
      ) : null}

      <GroupedList items={STEPS().map((s) => ({
        id: s.id, label: s.label, hint: s.hint, icon: s.icon,
        onPress: () => router.push(s.path as any),
        trailing: <Ionicons name={me.onboarding.steps[s.id] ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={me.onboarding.steps[s.id] ? theme.colors.success : theme.colors.textTertiary} />,
      }))} />
      <GroupedList title={t('workerSetup.makeYourProfileStronger')} items={[
        { id: 'about', label: t('workerAccount.aboutYouAndYour'), icon: 'person-outline', onPress: () => router.push('/setup/about' as any) },
        { id: 'portfolio', label: t('workerAccount.photosOfYourPast'), icon: 'images-outline', value: me.portfolio.length ? String(me.portfolio.length) : undefined, onPress: () => router.push('/setup/portfolio' as any) },
      ]} />
      {submitError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{submitError}</Text> : null}
    </Screen>
  );
}
