import React from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useNotifications } from '../../src/hooks/useNotifications';
import { tabIcon, tabScreenOptions } from '../../src/components/ds/tabBar';

export default function CustomerLayout() {
  const theme = useTheme();
  const { t } = useI18n();
  const { chatUnread } = useNotifications();
  const { bottom } = useSafeAreaInsets();

  return (
    <Tabs screenOptions={tabScreenOptions(theme, bottom)}>
      <Tabs.Screen name="(home)" options={{ title: t('nav.home'), tabBarIcon: tabIcon('home', 'home-outline', theme) }} />
      <Tabs.Screen name="bookings" options={{ title: t('nav.bookings'), tabBarIcon: tabIcon('calendar', 'calendar-outline', theme) }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('nav.messages'),
          tabBarBadge: chatUnread > 0 ? (chatUnread > 99 ? '99+' : chatUnread) : undefined,
          tabBarIcon: tabIcon('chatbubbles', 'chatbubbles-outline', theme),
        }}
      />
      <Tabs.Screen name="profile" options={{ title: t('nav.profile'), tabBarIcon: tabIcon('person', 'person-outline', theme) }} />
    </Tabs>
  );
}
