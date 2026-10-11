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

const LANG_LABEL = { en: 'English', ur: 'اردو', ar: 'العربية' } as const;
const APPEARANCE_LABEL = { system: 'Automatic', light: 'Light', dark: 'Dark' } as const;
const STATUS: Record<string, { text: string; color: 'success' | 'warning' | 'error' | 'textSecondary' }> = {
  ACTIVE: { text: 'Approved', color: 'success' },
  PENDING_REVIEW: { text: 'Being checked', color: 'warning' },
  ONBOARDING: { text: 'Finish your profile', color: 'warning' },
  REJECTED: { text: 'Not approved', color: 'error' },
  SUSPENDED: { text: 'Suspended', color: 'error' },
  INACTIVE: { text: 'Inactive', color: 'textSecondary' },
};

export default function WorkerAccountScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectCurrentUser);
  const appearance = useAppSelector(selectAppearance);
  const { locale } = useI18n();
  const { data: w, loading, error, reload } = useWorkerMe();
  const go = (path: string) => () => router.push(path as any);

  if (loading && !w) return <Screen title="Account"><LoadingState /></Screen>;
  if (error && !w) return <Screen title="Account"><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!w) return null;

  const st = STATUS[w.activationStatus] ?? STATUS.INACTIVE;

  return (
    <Screen title="Account" onRefresh={reload} refreshing={loading}>
      <TouchableOpacity onPress={go('/edit-profile')} accessibilityRole="button" accessibilityLabel="Edit profile" activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
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
          <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>Your profile is {w.onboarding.percent}% done</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.border, marginVertical: 10, overflow: 'hidden' }}>
            <View style={{ height: 8, width: `${w.onboarding.percent}%`, backgroundColor: theme.colors.primary }} />
          </View>
          <Button title={w.activationStatus === 'ONBOARDING' ? 'Continue setup' : 'View checklist'} variant="primary" onPress={go('/setup')} />
        </View>
      ) : null}

      <GroupedList title="Your profile" items={[
        { id: 'setup', label: 'Skills, area, hours and prices', icon: 'construct-outline', onPress: go('/setup') },
        { id: 'about', label: 'About you and your photo', icon: 'person-outline', onPress: go('/setup/about') },
        { id: 'portfolio', label: 'Photos of your past work', icon: 'images-outline', value: w.portfolio.length ? String(w.portfolio.length) : undefined, onPress: go('/setup/portfolio') },
        { id: 'docs', label: 'ID and selfie', icon: 'id-card-outline', onPress: go('/setup/documents') },
        { id: 'public', label: 'See how customers see you', icon: 'eye-outline', onPress: go(`/worker/${w.id}`) },
      ]} />
      <GroupedList items={[
        { id: 'prefs', label: 'Language & appearance', icon: 'language-outline', value: `${LANG_LABEL[locale]} · ${APPEARANCE_LABEL[appearance]}`, onPress: go('/preferences') },
      ]} />
      <GroupedList title="Security" items={[
        { id: 'password', label: 'Change password', icon: 'lock-closed-outline', onPress: go('/change-password') },
        { id: 'devices', label: 'Your devices', icon: 'phone-portrait-outline', onPress: go('/devices') },
        { id: 'delete', label: 'Delete account', icon: 'trash-outline', destructive: true, onPress: go('/delete-account') },
      ]} />
      <GroupedList items={[
        { id: 'logout', label: 'Log out', icon: 'log-out-outline', destructive: true, onPress: () => dispatch(logoutUser()) },
      ]} />
    </Screen>
  );
}
