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
    <Screen title={t('nav.profile') || 'Account'}>
      <TouchableOpacity onPress={go('/edit-profile')} accessibilityRole="button" accessibilityLabel="Edit profile" activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
        <Avatar name={user?.name} imageUrl={user?.profileImageUrl} size="xl" />
        <View style={{ marginStart: 16, flex: 1 }}>
          <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{user?.name}</Text>
          <Text variant="body" color={theme.colors.textSecondary}>{formatPhoneDisplay(user?.phone)}</Text>
          <Text variant="bodySmall" weight="medium" color={theme.colors.primary} style={{ marginTop: 2 }}>Edit profile</Text>
        </View>
      </TouchableOpacity>

      <GroupedList items={[
        { id: 'addresses', label: 'Saved addresses', icon: 'location-outline', value: addresses.data ? String(addresses.data.length) : undefined, onPress: go('/addresses') },
        { id: 'favorites', label: 'Favourite professionals', icon: 'heart-outline', onPress: go('/favorites') },
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
        { id: 'logout', label: t('common.logout') || 'Log out', icon: 'log-out-outline', destructive: true, onPress: () => dispatch(logoutUser()) },
      ]} />
    </Screen>
  );
}
