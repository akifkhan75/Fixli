import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, TouchableOpacity, View } from 'react-native';
import { useReduceMotion } from './useReduceMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './useTheme';
import { useLiveReload, useRealtime } from './useRealtime';
import { Text } from '../components/ds/Text';
import * as api from '../services/api';
import { setAppBadge, setupPush } from '../services/push';

interface Ctx {
  unread: number;
  refreshUnread: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
  /** Ask for push permission at a meaningful moment (see services/push.ts). */
  askForPush: () => Promise<void>;
}
const NotificationsContext = createContext<Ctx>({ unread: 0, refreshUnread: async () => {}, markRead: async () => {}, askForPush: async () => {} });

/** Notification paths are app routes we produced; anything else is ignored. */
export function openNotificationUrl(url?: unknown) {
  if (typeof url === 'string' && url.startsWith('/(')) router.push(url as any);
}

/** Lives inside the signed-in app: unread badge, in-app banner, push registration and taps. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);
  const [banner, setBanner] = useState<{ id: string; title: string; body: string; url?: string } | null>(null);

  const refreshUnread = useCallback(async () => {
    try { setUnread((await api.getUnreadCount()).count); } catch { /* offline: keep the last count */ }
  }, []);
  const markRead = useCallback(async (ids?: string[]) => {
    try { await api.markNotificationsRead(ids); } finally { await refreshUnread(); }
  }, [refreshUnread]);

  useEffect(() => { void setAppBadge(unread); }, [unread]);

  // Count stays right after reconnecting / returning to the app.
  useLiveReload(refreshUnread, [], () => false, { fallbackMs: 300_000 });
  useEffect(() => {
    void refreshUnread();
    void setupPush(false); // only if already allowed; never prompts here
  }, [refreshUnread]);

  useRealtime(['notification.created'], (e) => {
    setUnread((n) => n + 1);
    setBanner({ id: e.data.id, title: e.data.title, body: e.data.body, url: e.data.data?.url });
  });

  // A tap on a push (including the one that launched the app) opens the right screen.
  const handled = useRef(new Set<string>());
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const key = r.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      const data = r.notification.request.content.data as { url?: string; notificationId?: string };
      if (data?.notificationId) void markRead([data.notificationId]);
      openNotificationUrl(data?.url);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [markRead]);

  const askForPush = useCallback(async () => { await setupPush(true); }, []);

  return (
    <NotificationsContext.Provider value={{ unread, refreshUnread, markRead, askForPush }}>
      {children}
      {banner ? (
        <Banner
          key={banner.id} title={banner.title} body={banner.body}
          onPress={() => { void markRead([banner.id]); openNotificationUrl(banner.url); setBanner(null); }}
          onDone={() => setBanner(null)}
        />
      ) : null}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);

function Banner({ title, body, onPress, onDone }: { title: string; body: string; onPress: () => void; onDone: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-120)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) y.setValue(0); else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    const t = setTimeout(() => Animated.timing(y, { toValue: -160, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start(onDone), 5000);
    return () => clearTimeout(t);
  }, [y, onDone, reduceMotion]);
  return (
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, transform: [{ translateY: y }] }}>
      <TouchableOpacity
        onPress={onPress} activeOpacity={0.9} accessibilityRole="alert" accessibilityLabel={`${title}. ${body}`}
        style={{ backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.xl, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
      >
        <Ionicons name="notifications" size={22} color={theme.colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold" color={theme.colors.textPrimary} numberOfLines={1}>{title}</Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary} numberOfLines={2}>{body}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
