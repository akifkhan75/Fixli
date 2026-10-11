import React, { useCallback } from 'react';
import { View, FlatList, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from '../ds/Text';
import { Screen } from '../ds/Screen';
import { EmptyState, ErrorState, LoadingState } from '../ds/EmptyState';
import { useApi } from '../../hooks/useApi';
import * as api from '../../services/api';
import { useAppSelector } from '../../hooks/useRedux';
import { selectCurrentUser } from '../../store/authSlice';

export function ChatListScreen() {
  const theme = useTheme();
  const user = useAppSelector(selectCurrentUser);
  const { data, loading, error, reload } = useApi(async () => {
    const res = await api.getConversations();
    return res.items;
  });

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const renderItem = ({ item }: { item: api.ConversationItem }) => {
    const counterpart = item.participants.find(p => p.id !== user?.id) || item.participants[0];
    const lastMsg = item.messages?.[0];
    const unread = item.unreadCount > 0;

    return (
      <TouchableOpacity
        style={[styles.itemContainer, { backgroundColor: theme.colors.surface }]}
        onPress={() => {
          // Push to thread screen (assuming thread lives outside tabs at /thread/[id])
          router.push(`/thread/${item.id}`);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          {counterpart?.profileImageUrl ? (
            <Image source={{ uri: counterpart.profileImageUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.surfaceElevated }]}>
              <Ionicons name="person" size={24} color={theme.colors.textSecondary} />
            </View>
          )}
          {unread && <View style={[styles.unreadBadge, { backgroundColor: theme.colors.primary }]} />}
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.headerRow}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>
              {counterpart?.name || 'Unknown'}
            </Text>
            {lastMsg && (
              <Text variant="caption" color={theme.colors.textTertiary}>
                {new Date(lastMsg.createdAt).toLocaleDateString()}
              </Text>
            )}
          </View>
          
          <View style={styles.messageRow}>
            <Text 
              variant="body" 
              color={unread ? theme.colors.textPrimary : theme.colors.textSecondary}
              weight={unread ? 'bold' : 'normal'}
              numberOfLines={1}
              style={{ flex: 1 }}
            >
              {lastMsg ? (lastMsg.imageUrl ? '📷 Image' : lastMsg.text) : 'No messages yet'}
            </Text>
            {unread && (
              <View style={[styles.unreadCountBadge, { backgroundColor: theme.colors.primary }]}>
                <Text variant="caption" color={theme.colors.onPrimary} weight="bold">
                  {item.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen title="Messages" onRefresh={reload} refreshing={loading && !!data}>
      {loading && !data ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No messages"
          message="When you have active bookings, you can chat with the other party here."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 24,
  },
  itemContainer: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: 'white',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unreadCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  }
});
