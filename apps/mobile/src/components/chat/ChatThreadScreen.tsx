import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from '../ds/Text';
import { Screen } from '../ds/Screen';
import { LoadingState, ErrorState } from '../ds/EmptyState';
import { useAppSelector } from '../../hooks/useRedux';
import { selectCurrentUser } from '../../store/authSlice';
import * as api from '../../services/api';
import { realtime } from '../../services/socket';
import { useI18n } from '../../hooks/useI18n';

export function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const user = useAppSelector(selectCurrentUser);
  const { t } = useI18n();
  
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getConversationMessages(id!);
      setMessages(res.items);
      setError(null);
      
      // Mark as read in the background
      await api.markMessagesAsRead(id!);
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchMessages();
    }
  }, [id, fetchMessages]);

  useEffect(() => {
    if (!id) return;
    
    const handleNewMessage = (msg: api.ChatMessage) => {
      if (msg.conversationId === id) {
        setMessages((prev) => {
          // avoid duplicates if optimistic update already added it (based on ID or clientId)
          if (prev.some(m => m.id === msg.id || ((msg as any).clientId && (m as any).clientId === (msg as any).clientId))) return prev;
          return [msg, ...prev]; // inverted list
        });
        
        // If we are currently viewing this thread, automatically mark this new message as read
        if (msg.sender?.id !== user?.id) {
          api.markMessagesAsRead(id).catch(() => {});
        }
      }
    };

    const unsubscribe = realtime.onNewMessage(handleNewMessage as any);
    return unsubscribe;
  }, [id, user?.id]);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !id) return;
    
    setInputText('');
    setSending(true);

    const clientId = Date.now().toString() + Math.random().toString(36).substring(7);
    const optimisticMsg: api.ChatMessage = {
      id: clientId, // temporary ID
      conversationId: id,
      text,
      imageUrl: null,
      isSystem: false,
      createdAt: new Date().toISOString(),
      sender: { id: user!.id, name: user!.name },
      reads: [],
      clientId, // Store clientId for deduping
    } as any;

    setMessages(prev => [optimisticMsg, ...prev]);

    try {
      // The socket gateway listens to sendMessage and handles it
      // or we can use the API directly. We will use the REST API here for simplicity.
      await api.sendChatMessage(id, { text, clientId });
    } catch (err) {
      // Revert optimistic update on error if you wanted, or show error state.
      // For now, keep it simple.
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: api.ChatMessage }) => {
    if (item.isSystem) {
      return (
        <View style={styles.systemMessageContainer}>
          <Text variant="caption" color={theme.colors.textTertiary} style={{ textAlign: 'center' }}>
            {item.text}
          </Text>
        </View>
      );
    }

    const isMe = item.sender?.id === user?.id;
    return (
      <View style={[styles.messageBubble, isMe ? [styles.messageMine, { backgroundColor: theme.colors.primary }] : [styles.messageTheirs, { backgroundColor: theme.colors.surfaceElevated }]]}>
        <Text variant="bodyLarge" color={isMe ? theme.colors.onPrimary : theme.colors.textPrimary}>
          {item.text}
        </Text>
        <Text variant="caption" color={isMe ? 'rgba(255,255,255,0.7)' : theme.colors.textTertiary} style={{ marginTop: 4, alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
          {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  if (loading && !messages.length) return <Screen><LoadingState /></Screen>;
  if (error && !messages.length) return <Screen><ErrorState message={error} onRetry={fetchMessages} /></Screen>;

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: theme.colors.background }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{t('chat.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        inverted
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.inputContainer, { borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.colors.background, color: theme.colors.textPrimary }]}
          placeholder="Type a message..."
          placeholderTextColor={theme.colors.textTertiary}
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity 
          style={[styles.sendButton, { backgroundColor: inputText.trim() ? theme.colors.primary : theme.colors.surfaceElevated }]}
          onPress={sendMessage}
          disabled={!inputText.trim()}
        >
          <Ionicons name="send" size={20} color={inputText.trim() ? theme.colors.onPrimary : theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  systemMessageContainer: {
    marginVertical: 12,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginVertical: 4,
  },
  messageMine: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  messageTheirs: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
});
