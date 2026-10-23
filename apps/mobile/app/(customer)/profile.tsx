import React, { useCallback } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { formatPhoneDisplay } from '@fixli/shared';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser, logoutUser } from '../../src/store/authSlice';
import { selectAppearance } from '../../src/store/uiSlice';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useApi } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Avatar } from '../../src/components/ds/Avatar';
import { GroupedList } from '../../src/components/ds/GroupedList';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';
import { openLegal } from '../../src/utils/legal';

const LANG_LABEL = { en: 'English', ur: 'اردو', ar: 'العربية' } as const;
const APPEARANCE_LABEL = { system: 'Automatic', light: 'Light', dark: 'Dark' } as const;

export default function AccountScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectCurrentUser);
  const appearance = useAppSelector(selectAppearance);
  const { locale, t } = useI18n();
  const addresses = useApi(api.getAddresses);
  useFocusEffect(useCallback(() => { addresses.reload(); }, [addresses.reload]));

  const go = (path: string) => () => router.push(path as any);

  return (
    <Screen title={t('nav.profile')}>
      <TouchableOpacity onPress={go('/edit-profile')} accessibilityRole="button" accessibilityLabel={t('customerProfile.editProfile')} activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
        <Avatar name={user?.name} imageUrl={user?.profileImageUrl} size="xl" />
        <View style={{ marginStart: 16, flex: 1 }}>
          <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{user?.name}</Text>
          <Text variant="body" color={theme.colors.textSecondary}>{formatPhoneDisplay(user?.phone)}</Text>
          <Text variant="bodySmall" weight="medium" color={theme.colors.primaryText} style={{ marginTop: 2 }}>{t('customerProfile.editProfile')}</Text>
        </View>
      </TouchableOpacity>

      <GroupedList items={[
        { id: 'addresses', label: t('customerProfile.savedAddresses'), icon: 'location-outline', value: addresses.data ? String(addresses.data.length) : undefined, onPress: go('/addresses') },
        { id: 'favorites', label: t('customerProfile.favouriteProfessionals'), icon: 'heart-outline', onPress: go('/favorites') },
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
        { id: 'logout', label: t('common.logout'), icon: 'log-out-outline', destructive: true, onPress: () => dispatch(logoutUser()) },
      ]} />
    </Screen>
  );
}
