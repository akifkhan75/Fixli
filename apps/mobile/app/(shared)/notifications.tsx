import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { friendlyError } from '../../src/hooks/useApi';
import { useLiveReload } from '../../src/hooks/useRealtime';
import { openNotificationUrl, useNotifications } from '../../src/hooks/useNotifications';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'job.request': 'flash-outline', 'job.direct_request': 'person-add-outline', 'offer.received': 'pricetag-outline',
  'offer.accepted': 'checkmark-circle-outline', 'offer.not_chosen': 'close-circle-outline',
  'job.accepted': 'checkmark-circle-outline', 'job.started': 'construct-outline', 'job.completed': 'flag-outline',
  'job.cancelled': 'close-circle-outline', 'job.declined': 'alert-circle-outline', 'job.no_one_available': 'search-outline',
  'verification.approved': 'shield-checkmark-outline', 'verification.needs_fix': 'document-text-outline', 'worker.activated': 'ribbon-outline',
};

function when(iso: string, locale: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const { unread, markRead } = useNotifications();
  const [items, setItems] = useState<api.AppNotification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try { const page = await api.listNotifications(); setItems(page.items); setCursor(page.nextCursor); }
    catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }, []);
  const more = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try { const page = await api.listNotifications(cursor); setItems((prev) => [...(prev ?? []), ...page.items]); setCursor(page.nextCursor); }
    catch { /* keep what we have */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [load]);
  useLiveReload(load, ['notification.created']);

  const open = (n: api.AppNotification) => {
    if (!n.readAt) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? prev);
      void markRead([n.id]);
    }
    openNotificationUrl(n.data?.url);
  };
  const readAll = async () => {
    setItems((prev) => prev?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? prev);
    await markRead();
  };

  if (!items && loading) return <Screen title={t('sharedNotifications.notifications')} back><LoadingState /></Screen>;
  if (!items && error) return <Screen title={t('sharedNotifications.notifications')} back><ErrorState message={error} onRetry={load} /></Screen>;

  return (
    <Screen title={t('sharedNotifications.notifications')} back scroll={false}>
      {unread > 0 ? <View style={{ alignSelf: 'flex-end', marginTop: -8, marginBottom: 8 }}><Button title={t('sharedNotifications.markAllAsRead')} variant="ghost" onPress={readAll} /></View> : null}
      <FlatList
        data={items ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading && !!items} onRefresh={load} tintColor={theme.colors.primary} />}
        onEndReached={more}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<EmptyState icon="notifications-off-outline" title={t('sharedNotifications.nothingYet')} message={t('sharedNotifications.updatesAboutYourRequests')} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item: n }) => (
          <TouchableOpacity
            onPress={() => open(n)} activeOpacity={0.8} accessibilityRole="button"
            accessibilityLabel={`${n.readAt ? '' : 'Unread. '}${n.title}. ${n.body}`}
            style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: theme.borderRadius.xl, backgroundColor: n.readAt ? theme.colors.surface : theme.colors.primary + '14' }}
          >
            <Ionicons name={ICON[n.type] ?? 'notifications-outline'} size={24} color={n.readAt ? theme.colors.textSecondary : theme.colors.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="body" weight={n.readAt ? 'medium' : 'bold'} color={theme.colors.textPrimary} style={{ flex: 1 }}>{n.title}</Text>
                <Text variant="caption" color={theme.colors.textTertiary}>{when(n.createdAt, locale)}</Text>
              </View>
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 2 }}>{n.body}</Text>
            </View>
            {!n.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary, marginTop: 8 }} /> : null}
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}
