import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, TextInput as RNTextInput, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { routes } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { friendlyError } from '../../hooks/useApi';
import { useRealtime, useLiveReload } from '../../hooks/useRealtime';
import { usePhotoUpload } from '../../hooks/usePhotoUpload';
import { useAppSelector } from '../../hooks/useRedux';
import { selectCurrentUser } from '../../store/authSlice';
import { chatOutbox, newClientId, type OutboxItem } from '../../services/chatOutbox';
import { realtime } from '../../services/socket';
import * as api from '../../services/api';
import { Screen } from '../ds/Screen';
import { Text } from '../ds/Text';
import { Button } from '../ds/Button';
import { ChipChoice } from '../ds/ChipChoice';
import { ErrorState, LoadingState } from '../ds/EmptyState';

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; m: api.ChatMessage }
  | { kind: 'out'; key: string; o: OutboxItem };

const REPORT_REASONS: { id: api.ReportReason; label: string }[] = [
  { id: 'HARASSMENT', label: 'Harassment' },
  { id: 'SCAM', label: 'Scam or asking for money' },
  { id: 'UNSAFE', label: 'I feel unsafe' },
  { id: 'INAPPROPRIATE', label: 'Inappropriate messages' },
  { id: 'OTHER', label: 'Something else' },
];

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * One chat. Messages go into the outbox first (sent in order, once, even after going offline);
 * everything the other side does arrives live: new messages, read ticks, typing.
 */
export function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { locale } = useI18n();
  const me = useAppSelector(selectCurrentUser);
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [meta, setMeta] = useState<api.ConversationMeta | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [typingUntil, setTypingUntil] = useState(0);
  const [hint, setHint] = useState(false);
  const [menu, setMenu] = useState<null | 'menu' | 'report'>(null);
  const [reportReason, setReportReason] = useState<string[]>([]);
  const [actionMsg, setActionMsg] = useState<string | undefined>();
  const photo = usePhotoUpload('CHAT_PHOTO');
  const lastTypingSent = useRef(0);

  const merge = useCallback((incoming: api.ChatMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
      return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.getConversationMessages(id!);
      merge(res.items);
      setMeta(res.conversation);
      setCursor(res.nextCursor);
      setError(null);
      void api.markMessagesAsRead(id!).catch(() => undefined);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [id, merge]);

  useEffect(() => { void load(); }, [load]);
  // After a gap (offline, app in background), re-read rather than trust that nothing was missed.
  useLiveReload(load, ['conversation.updated'], (e) => e.data?.conversationId === id, { fallbackMs: 300_000 });

  useEffect(() => {
    const refresh = () => void chatOutbox.list(id!).then(setOutbox);
    refresh();
    return chatOutbox.subscribe((e) => {
      refresh();
      if (e.type === 'sent' && e.message.conversationId === id) {
        merge([e.message]);
        if (e.message.warning === 'CONTACT_INFO') setHint(true);
      }
    });
  }, [id, merge]);

  useRealtime(['message.created', 'message.read', 'chat.typing'], (e) => {
    if (e.data?.conversationId !== id) return;
    if (e.type === 'message.created') {
      merge([e.data]);
      if (e.data.sender?.id !== me?.id) { setTypingUntil(0); void api.markMessagesAsRead(id!).catch(() => undefined); }
    } else if (e.type === 'message.read') {
      const ids = new Set<string>(e.data.messageIds);
      setMessages((prev) => prev.map((m) => (ids.has(m.id) && !m.reads.some((r) => r.userId === e.data.userId) ? { ...m, reads: [...m.reads, { userId: e.data.userId, readAt: e.data.readAt }] } : m)));
    } else if (e.type === 'chat.typing' && e.data.userId !== me?.id) {
      setTypingUntil(Date.now() + 5_000);
    }
  });
  useEffect(() => {
    if (!typingUntil) return undefined;
    const t = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(t);
  }, [typingUntil]);

  const older = async () => {
    if (!cursor) return;
    const res = await api.getConversationMessages(id!, cursor);
    merge(res.items);
    setCursor(res.nextCursor);
  };

  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTypingSent.current > 3_000) { lastTypingSent.current = Date.now(); realtime.typing(id!); }
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t || !me) return;
    setText('');
    await chatOutbox.add({ clientId: newClientId(), conversationId: id!, senderId: me.id, text: t });
  };
  const sendPhoto = async (source: 'camera' | 'library') => {
    if (!me) return;
    const up = await photo.run(source);
    if (up) await chatOutbox.add({ clientId: newClientId(), conversationId: id!, senderId: me.id, imageUploadId: up.id, localImageUri: up.localUri });
  };

  const block = async () => {
    try { await api.blockInConversation(id!); setMenu(null); setActionMsg('Blocked. You won\'t get messages, requests or prices from each other.'); await load(); }
    catch (e) { setActionMsg(friendlyError(e)); }
  };
  const report = async () => {
    if (!reportReason[0]) return;
    try { await api.reportInConversation(id!, reportReason[0] as api.ReportReason); setMenu(null); setActionMsg('Thanks. The Fixli safety team will look into it.'); }
    catch (e) { setActionMsg(friendlyError(e)); }
  };

  // Newest first (inverted list): server messages + my outbox items, with a day label between days.
  const rows = useMemo<Row[]>(() => {
    const sentClientIds = new Set(messages.map((m) => m.clientId).filter(Boolean));
    const out = outbox.filter((o) => !sentClientIds.has(o.clientId)).map((o) => ({ at: o.createdAt, row: { kind: 'out' as const, key: o.clientId, o } }));
    const ms = messages.map((m) => ({ at: m.createdAt, row: { kind: 'msg' as const, key: m.id, m } }));
    const all = [...out, ...ms].sort((a, b) => b.at.localeCompare(a.at));
    const res: Row[] = [];
    all.forEach((x, i) => {
      res.push(x.row);
      const d = new Date(x.at);
      const nextOlder = all[i + 1] ? new Date(all[i + 1].at) : null;
      if (!nextOlder || !sameDay(d, nextOlder)) {
        res.push({ kind: 'day', key: `day-${d.toDateString()}`, label: sameDay(d, new Date()) ? 'Today' : d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) });
      }
    });
    return res;
  }, [messages, outbox, locale]);

  if (loading && !messages.length) return <Screen title="Chat" back><LoadingState /></Screen>;
  if (error && !messages.length) return <Screen title="Chat" back><ErrorState message={error} onRetry={load} /></Screen>;

  const other = meta?.counterpart;
  const closed = meta?.isReadOnly;
  const blocked = meta?.blocked;
  const canSend = !closed && !blocked;
  const tick = (m: api.ChatMessage) => (other && m.reads.some((r) => r.userId === other.id) ? 'checkmark-done' : 'checkmark');

  const bubble = (mine: boolean, children: React.ReactNode, footer: React.ReactNode) => (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', marginVertical: 3, padding: 10, borderRadius: 16, backgroundColor: mine ? theme.colors.primary : theme.colors.surfaceElevated }}>
      {children}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>{footer}</View>
    </View>
  );
  const time = (iso: string, mine: boolean) => <Text variant="caption" color={mine ? 'rgba(255,255,255,0.75)' : theme.colors.textTertiary}>{new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}</Text>;

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'day') return <Text variant="caption" color={theme.colors.textTertiary} style={{ textAlign: 'center', marginVertical: 10 }}>{item.label}</Text>;
    if (item.kind === 'out') {
      const o = item.o;
      const failed = o.status === 'failed';
      return (
        <TouchableOpacity disabled={!failed} onPress={() => void chatOutbox.retry(o.clientId)} onLongPress={() => void chatOutbox.discard(o.clientId)}
          accessibilityRole={failed ? 'button' : undefined} accessibilityLabel={failed ? 'Not sent. Tap to retry, hold to delete.' : 'Sending'}>
          {bubble(true, <>
            {o.localImageUri ? <Image source={{ uri: o.localImageUri }} style={{ width: 200, height: 200, borderRadius: 10, opacity: 0.7 }} /> : null}
            {o.text ? <Text variant="bodyLarge" color={theme.colors.onPrimary}>{o.text}</Text> : null}
          </>, failed
            ? <><Ionicons name="alert-circle" size={14} color="#FFFFFF" /><Text variant="caption" color="#FFFFFF">Not sent · Tap to retry</Text></>
            : <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.75)" accessibilityLabel="Sending" />)}
        </TouchableOpacity>
      );
    }
    const m = item.m;
    if (m.isSystem) return <Text variant="caption" color={theme.colors.textTertiary} style={{ textAlign: 'center', marginVertical: 8, paddingHorizontal: 24 }}>{m.text}</Text>;
    const mine = m.sender?.id === me?.id;
    return bubble(mine, <>
      {m.imageUrl ? <Image source={{ uri: m.imageUrl }} accessibilityLabel="Photo" style={{ width: 200, height: 200, borderRadius: 10 }} /> : null}
      {m.text ? <Text variant="bodyLarge" color={mine ? theme.colors.onPrimary : theme.colors.textPrimary}>{m.text}</Text> : null}
    </>, <>{time(m.createdAt, mine)}{mine ? <Ionicons name={tick(m)} size={14} color="rgba(255,255,255,0.85)" accessibilityLabel={tick(m) === 'checkmark-done' ? 'Read' : 'Sent'} /> : null}</>);
  };

  const composer = canSend ? (
    <View>
      {hint ? (
        <TouchableOpacity onPress={() => setHint(false)} accessibilityRole="button" style={{ backgroundColor: theme.colors.warning + '22', borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <Text variant="bodySmall" color={theme.colors.textPrimary}>Tip: keep chatting and paying through Fixli. If something goes wrong, we can only help with what happened here.</Text>
        </TouchableOpacity>
      ) : null}
      {photo.error ? <Text variant="bodySmall" color={theme.colors.error} style={{ marginBottom: 6 }}>{photo.error}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TouchableOpacity onPress={() => void sendPhoto('library')} onLongPress={() => void sendPhoto('camera')} disabled={photo.busy} accessibilityRole="button" accessibilityLabel="Send a photo (hold for camera)" style={{ padding: 8 }}>
          <Ionicons name={photo.busy ? 'hourglass-outline' : 'image-outline'} size={26} color={theme.colors.textSecondary} />
        </TouchableOpacity>
        <RNTextInput
          value={text} onChangeText={onType} placeholder="Type a message" placeholderTextColor={theme.colors.textTertiary} multiline maxLength={4000}
          accessibilityLabel="Message"
          style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, writingDirection: 'auto' as any }}
        />
        <TouchableOpacity onPress={sendText} disabled={!text.trim()} accessibilityRole="button" accessibilityLabel="Send"
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: text.trim() ? theme.colors.primary : theme.colors.surfaceElevated }}>
          <Ionicons name="send" size={20} color={text.trim() ? theme.colors.onPrimary : theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  ) : (
    <Text variant="body" color={theme.colors.textSecondary} style={{ textAlign: 'center' }}>
      {blocked ? "You can't message each other." : closed ? `This chat closed${meta?.closedAt ? ` on ${new Date(meta.closedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}` : ''}. Report a problem on the job if you need help.` : ''}
    </Text>
  );

  return (
    <Screen title={other?.name ?? 'Chat'} back scroll={false} footer={composer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -8, marginBottom: 6 }}>
        {meta?.job ? (
          <TouchableOpacity style={{ flex: 1 }} accessibilityRole="button" onPress={() => router.push(routes.jobFor(meta.job!.id, me?.type === 'worker' ? 'worker' : 'customer') as any)}>
            <Text variant="bodySmall" color={theme.colors.primary} numberOfLines={1}>{meta.job.title ?? 'View job'} ›</Text>
          </TouchableOpacity>
        ) : <View style={{ flex: 1 }} />}
        {typingUntil ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginEnd: 8 }}>typing…</Text> : null}
        <TouchableOpacity onPress={() => setMenu(menu ? null : 'menu')} accessibilityRole="button" accessibilityLabel="More options" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {menu === 'menu' ? (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
          {!blocked ? <View style={{ flex: 1 }}><Button title="Block" variant="secondary" onPress={block} /></View> : null}
          <View style={{ flex: 1 }}><Button title="Report" variant="danger" onPress={() => setMenu('report')} /></View>
        </View>
      ) : menu === 'report' ? (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <ChipChoice options={REPORT_REASONS} selectedIds={reportReason} onChange={setReportReason} />
          <Button title="Send report" variant="danger" disabled={!reportReason[0]} onPress={report} />
        </View>
      ) : null}
      {actionMsg ? <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginBottom: 6 }}>{actionMsg}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        inverted
        onEndReached={older}
        onEndReachedThreshold={0.3}
        contentContainerStyle={{ paddingVertical: 8 }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}
