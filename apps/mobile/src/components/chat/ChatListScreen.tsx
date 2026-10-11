import React, { useCallback } from 'react';
import { FlatList, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { routes } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { useApi } from '../../hooks/useApi';
import { useLiveReload } from '../../hooks/useRealtime';
import { Text } from '../ds/Text';
import { Screen } from '../ds/Screen';
import { Avatar } from '../ds/Avatar';
import { EmptyState, ErrorState, LoadingState } from '../ds/EmptyState';
import * as api from '../../services/api';

/** Your chats, newest first, updating live (new messages, reads, blocks). */
export function ChatListScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const { data, loading, error, reload } = useApi(async () => (await api.getConversations()).items);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useLiveReload(reload, ['conversation.updated', 'message.created']);

  const when = (iso: string) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };

  const renderItem = ({ item }: { item: api.ConversationItem }) => {
    const unread = item.unreadCount > 0;
    const last = item.lastMessage;
    const preview = !last ? 'No messages yet' : last.imageUrl ? '📷 Photo' : last.text ?? '';
    const status = item.blockedByMe ? 'Blocked' : item.isReadOnly ? 'Closed' : null;
    return (
      <TouchableOpacity onPress={() => router.push(routes.thread(item.id) as any)} activeOpacity={0.7} accessibilityRole="button"
        accessibilityLabel={`${item.counterpart?.name ?? 'Chat'}${unread ? `, ${item.unreadCount} unread` : ''}. ${preview}`}
        style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: theme.borderRadius.xl, marginBottom: 10, backgroundColor: theme.colors.surface }}>
        <Avatar name={item.counterpart?.name} imageUrl={item.counterpart?.profileImageUrl} size="md" />
        <View style={{ flex: 1, marginStart: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary} style={{ flex: 1 }} numberOfLines={1}>{item.counterpart?.name ?? 'Chat'}</Text>
            {item.lastMessageAt ? <Text variant="caption" color={theme.colors.textTertiary}>{when(item.lastMessageAt)}</Text> : null}
          </View>
          {item.job?.title ? <Text variant="caption" color={theme.colors.textSecondary} numberOfLines={1}>{item.job.title}{status ? ` · ${status}` : ''}</Text> : status ? <Text variant="caption" color={theme.colors.textSecondary}>{status}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <Text variant="body" color={unread ? theme.colors.textPrimary : theme.colors.textSecondary} weight={unread ? 'bold' : 'normal'} numberOfLines={1} style={{ flex: 1 }}>{preview}</Text>
            {unread ? (
              <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary, marginStart: 8 }}>
                <Text variant="caption" weight="bold" color={theme.colors.onPrimary}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen title="Messages" scroll={false}>
      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          onRefresh={reload}
          refreshing={loading && !!data}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No messages" message="Once a job is booked, you can chat with the other person here." />}
        />
      )}
    </Screen>
  );
}
