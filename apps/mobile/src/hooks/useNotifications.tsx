import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, TouchableOpacity, View } from 'react-native';
import { useReduceMotion } from './useReduceMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './useTheme';
import { useLiveReload, useRealtime } from './useRealtime';
import { Text } from '../components/ds/Text';
import * as api from '../services/api';
import { setAppBadge, setupPush } from '../services/push';
import { playNotifyFeedback } from '../services/notifyFeedback';
import { t } from '../i18n';
import { useAppSelector } from './useRedux';
import { selectCurrentUser } from '../store/authSlice';

interface Ctx {
  unread: number;
  /** Unread chat messages across all conversations (Messages tab badge). */
  chatUnread: number;
  refreshUnread: () => Promise<void>;
  refreshChatUnread: () => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
  /** Ask for push permission at a meaningful moment (see services/push.ts). */
  askForPush: () => Promise<void>;
}
const NotificationsContext = createContext<Ctx>({
  unread: 0, chatUnread: 0, refreshUnread: async () => {}, refreshChatUnread: async () => {},
  markRead: async () => {}, askForPush: async () => {},
});

/** Notification paths are app routes we produced; anything else is ignored. */
export function openNotificationUrl(url?: unknown) {
  if (typeof url !== 'string' || (!url.startsWith('/(') && !url.startsWith('/thread/'))) return;
  // Links stored before the stack move (and the old chat path) still open the right screen.
  const path = url
    .replace(/^\/\(customer\)\/job\//, '/(customer)/(home)/job/')
    .replace(/^\/\(shared\)\/chat\//, '/thread/');
  router.push(path as any);
}

function threadIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/thread\/([^/?#]+)/) || url.match(/\/\(shared\)\/chat\/([^/?#]+)/);
  return m?.[1] ?? null;
}

/** Lives inside the signed-in app: unread badge, in-app banner, push registration and taps. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const me = useAppSelector(selectCurrentUser);
  const meId = useRef(me?.id);
  meId.current = me?.id;
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [banner, setBanner] = useState<{ id: string; title: string; body: string; url?: string } | null>(null);

  const refreshUnread = useCallback(async () => {
    try { setUnread((await api.getUnreadCount()).count); } catch { /* offline: keep the last count */ }
  }, []);
  const refreshChatUnread = useCallback(async () => {
    try {
      const page = await api.getConversations();
      setChatUnread(page.items.reduce((n, c) => n + (c.unreadCount || 0), 0));
    } catch { /* offline: keep the last count */ }
  }, []);
  const markRead = useCallback(async (ids?: string[]) => {
    try { await api.markNotificationsRead(ids); } finally { await refreshUnread(); }
  }, [refreshUnread]);

  useEffect(() => { void setAppBadge(unread + chatUnread); }, [unread, chatUnread]);

  // Count stays right after reconnecting / returning to the app.
  useLiveReload(refreshUnread, [], () => false, { fallbackMs: 300_000 });
  useLiveReload(refreshChatUnread, [], () => false, { fallbackMs: 120_000 });
  useEffect(() => {
    void refreshUnread();
    void refreshChatUnread();
    void setupPush(false); // only if already allowed; never prompts here
  }, [refreshUnread, refreshChatUnread]);

  // A chat beat arrives twice (message.created and notification.created); toast it once.
  const recentChatToast = useRef(new Map<string, number>());
  const wasChatToasted = (conversationId?: string | null) => {
    const at = conversationId ? recentChatToast.current.get(conversationId) : undefined;
    return !!at && Date.now() - at < 2500;
  };

  const showToast = useCallback((n: { id: string; title: string; body: string; url?: string }) => {
    const thread = threadIdFromUrl(n.url);
    // Already reading this chat: no banner, just keep the badge right.
    if (thread && pathnameRef.current?.includes(`/thread/${thread}`)) { void refreshChatUnread(); return; }
    setBanner({ id: n.id, title: n.title, body: n.body, url: n.url });
    void playNotifyFeedback();
  }, [refreshChatUnread]);

  useRealtime(['notification.created'], (e) => {
    setUnread((n) => n + 1);
    const d = e.data as { id: string; type?: string; title: string; body: string; data?: { url?: string; conversationId?: string } };
    const convId = d.data?.conversationId ?? threadIdFromUrl(d.data?.url);
    if (d.type === 'chat.message' || convId) void refreshChatUnread();
    if (d.type === 'chat.message' && wasChatToasted(convId)) return;
    showToast({ id: d.id, title: d.title, body: d.body, url: d.data?.url });
  });

  // Live chat message: toast + Messages tab badge (own messages from another device are ignored).
  useRealtime(['message.created'], (e) => {
    const msg = e.data as { id: string; conversationId?: string; text?: string | null; imageUrl?: string | null; sender?: { id: string; name?: string | null } };
    if (!msg?.conversationId) return;
    void refreshChatUnread();
    if (msg.sender?.id === meId.current) return;
    if (pathnameRef.current?.includes(`/thread/${msg.conversationId}`)) return;
    recentChatToast.current.set(msg.conversationId, Date.now());
    showToast({
      id: `msg-${msg.id}`, title: msg.sender?.name ?? t('chatToast.newMessage'),
      body: msg.text || (msg.imageUrl ? t('chatToast.sentPhoto') : t('chatToast.sentMessage')), url: `/thread/${msg.conversationId}`,
    });
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
    <NotificationsContext.Provider value={{ unread, chatUnread, refreshUnread, refreshChatUnread, markRead, askForPush }}>
      {children}
      {banner ? (
        <Banner
          key={banner.id} title={banner.title} body={banner.body}
          onPress={() => { if (!banner.id.startsWith('msg-')) void markRead([banner.id]); openNotificationUrl(banner.url); setBanner(null); void refreshChatUnread(); }}
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
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 9999, elevation: 24, transform: [{ translateY: y }] }}>
      <TouchableOpacity
        onPress={onPress} activeOpacity={0.9} accessibilityRole="alert" accessibilityLabel={`${title}. ${body}`}
        style={{ backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.xl, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}
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
