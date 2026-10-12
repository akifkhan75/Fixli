import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatPhoneDisplay } from '@fixli/shared';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser, logoutUser } from '../../src/store/authSlice';
import { selectAppearance } from '../../src/store/uiSlice';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useWorkerMe } from '../../src/hooks/useWorkerMe';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Avatar } from '../../src/components/ds/Avatar';
import { Button } from '../../src/components/ds/Button';
import { GroupedList } from '../../src/components/ds/GroupedList';
import { ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { t } from '../../src/i18n';
import { openLegal } from '../../src/utils/legal';

const LANG_LABEL = { en: 'English', ur: 'اردو', ar: 'العربية' } as const;
const APPEARANCE_LABEL = { system: 'Automatic', light: 'Light', dark: 'Dark' } as const;
const STATUS = (): Record<string, { text: string; color: 'success' | 'warning' | 'error' | 'textSecondary' }> => ({
  ACTIVE: { text: t('workerAccount.approved'), color: 'success' },
  PENDING_REVIEW: { text: t('workerAccount.beingChecked'), color: 'warning' },
  ONBOARDING: { text: t('workerAccount.finishYourProfile'), color: 'warning' },
  REJECTED: { text: t('workerAccount.notApproved'), color: 'error' },
  SUSPENDED: { text: t('workerAccount.suspended'), color: 'error' },
  INACTIVE: { text: t('workerAccount.inactive'), color: 'textSecondary' },
});

export default function WorkerAccountScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectCurrentUser);
  const appearance = useAppSelector(selectAppearance);
  const { locale } = useI18n();
  const { data: w, loading, error, reload } = useWorkerMe();
  const go = (path: string) => () => router.push(path as any);

  if (loading && !w) return <Screen title={t('customerProfile.account')}><LoadingState /></Screen>;
  if (error && !w) return <Screen title={t('customerProfile.account')}><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!w) return null;

  const st = STATUS()[w.activationStatus] ?? STATUS().INACTIVE;

  return (
    <Screen title={t('customerProfile.account')} onRefresh={reload} refreshing={loading}>
      <TouchableOpacity onPress={go('/edit-profile')} accessibilityRole="button" accessibilityLabel={t('customerProfile.editProfile')} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <Avatar name={user?.name} imageUrl={user?.profileImageUrl} size="xl" />
        <View style={{ marginStart: 16, flex: 1 }}>
          <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{user?.name}</Text>
          <Text variant="body" color={theme.colors.textSecondary}>{formatPhoneDisplay(user?.phone)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Ionicons name={w.isVerified ? 'shield-checkmark' : 'shield-outline'} size={16} color={theme.colors[st.color]} />
            <Text variant="bodySmall" weight="semibold" color={theme.colors[st.color]} style={{ marginStart: 6 }}>{st.text}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {w.activationStatus === 'ONBOARDING' || w.activationStatus === 'PENDING_REVIEW' ? (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 24 }}>
          <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{t('workerAccount.profilePercent', { percent: w.onboarding.percent })}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.border, marginVertical: 10, overflow: 'hidden' }}>
            <View style={{ height: 8, width: `${w.onboarding.percent}%`, backgroundColor: theme.colors.primary }} />
          </View>
          <Button title={w.activationStatus === 'ONBOARDING' ? t('workerAccount.continueSetup') : t('workerAccount.viewChecklist')} variant="primary" onPress={go('/setup')} />
        </View>
      ) : null}

      <GroupedList title={t('workerAccount.yourProfile')} items={[
        { id: 'setup', label: t('workerAccount.skillsAreaHoursAnd'), icon: 'construct-outline', onPress: go('/setup') },
        { id: 'about', label: t('workerAccount.aboutYouAndYour'), icon: 'person-outline', onPress: go('/setup/about') },
        { id: 'portfolio', label: t('workerAccount.photosOfYourPast'), icon: 'images-outline', value: w.portfolio.length ? String(w.portfolio.length) : undefined, onPress: go('/setup/portfolio') },
        { id: 'docs', label: t('workerAccount.idAndSelfie'), icon: 'id-card-outline', onPress: go('/setup/documents') },
        { id: 'public', label: t('workerAccount.seeHowCustomersSee'), icon: 'eye-outline', onPress: go(`/worker/${w.id}`) },
      ]} />
      <GroupedList items={[
        { id: 'prefs', label: t('customerProfile.languageAppearance'), icon: 'language-outline', value: `${LANG_LABEL[locale]} · ${APPEARANCE_LABEL[appearance]}`, onPress: go('/preferences') },
      ]} />
      <GroupedList title={t('customerProfile.security')} items={[
        { id: 'password', label: t('customerProfile.changePassword'), icon: 'lock-closed-outline', onPress: go('/change-password') },
        { id: 'devices', label: t('customerProfile.yourDevices'), icon: 'phone-portrait-outline', onPress: go('/devices') },
        { id: 'blocked', label: t('customerProfile.blockedPeople'), icon: 'hand-left-outline', onPress: go('/blocked') },
        { id: 'trusted', label: t('customerProfile.trustedContactsSos'), icon: 'people-outline', onPress: go('/trusted-contacts') },
        { id: 'delete', label: t('customerProfile.deleteAccount'), icon: 'trash-outline', destructive: true, onPress: go('/delete-account') },
      ]} />
      <GroupedList title={t('legal.title')} items={[
        { id: 'privacy', label: t('legal.privacy'), icon: 'shield-checkmark-outline', onPress: () => void openLegal('privacy') },
        { id: 'terms', label: t('legal.terms'), icon: 'document-text-outline', onPress: () => void openLegal('terms') },
      ]} />
      <GroupedList items={[
        { id: 'logout', label: t('workerAccount.logOut'), icon: 'log-out-outline', destructive: true, onPress: () => dispatch(logoutUser()) },
      ]} />
    </Screen>
  );
}
