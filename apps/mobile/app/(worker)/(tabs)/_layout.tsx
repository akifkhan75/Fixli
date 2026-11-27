import React from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../src/hooks/useTheme';
import { t } from '../../../src/i18n';
import { useNotifications } from '../../../src/hooks/useNotifications';
import { tabIcon, tabScreenOptions } from '../../../src/components/ds/tabBar';

export default function WorkerLayout() {
  const theme = useTheme();
  const { chatUnread } = useNotifications();
  const { bottom } = useSafeAreaInsets();

  return (
    <Tabs screenOptions={tabScreenOptions(theme, bottom)}>
      <Tabs.Screen name="today" options={{ title: t('customerRequestService.today'), tabBarIcon: tabIcon('sunny', 'sunny-outline', theme) }} />
      <Tabs.Screen name="jobs" options={{ title: t('worker.jobs'), tabBarIcon: tabIcon('briefcase', 'briefcase-outline', theme) }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('worker.messages'),
          tabBarBadge: chatUnread > 0 ? (chatUnread > 99 ? '99+' : chatUnread) : undefined,
          tabBarIcon: tabIcon('chatbubbles', 'chatbubbles-outline', theme),
        }}
      />
      <Tabs.Screen name="earnings" options={{ title: t('worker.earnings'), tabBarIcon: tabIcon('wallet', 'wallet-outline', theme) }} />
      <Tabs.Screen name="account" options={{ title: t('customerProfile.account'), tabBarIcon: tabIcon('person', 'person-outline', theme) }} />
    </Tabs>
  );
}
