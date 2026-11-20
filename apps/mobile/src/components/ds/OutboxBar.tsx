import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { routes } from '@fixli/shared';
import { useAppSelector } from '../../hooks/useRedux';
import { selectCurrentUser } from '../../store/authSlice';
import { useI18n } from '../../hooks/useI18n';
import { useOutbox } from '../../hooks/useOutbox';
import { useTheme } from '../../hooks/useTheme';
import { outbox } from '../../services/outbox';
import { Text } from './Text';

/**
 * One slim bar at the top, only when there's something to say (doc 27 F7.1):
 * no signal ("Offline"), things saved and waiting to send, something the server refused, or a
 * request that was waiting and has now gone out.
 */
export function OutboxBar() {
  const { t } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAppSelector(selectCurrentUser);
  const { online, waiting, failed } = useOutbox(user?.id);
  const [sentJob, setSentJob] = useState<string | null>(null);

  useEffect(() => outbox.subscribe((e) => {
    if (e.type === 'sent' && e.item.kind === 'job_request') {
      const id = (e.result as { id?: string } | null)?.id;
      if (id) { setSentJob(id); setTimeout(() => setSentJob((cur) => (cur === id ? null : cur)), 10_000); }
    }
  }), []);

  let text: string | null = null;
  let tone = theme.colors.warning;
  let onPress: (() => void) | undefined;
  if (failed.length) {
    text = t('offline.failed', { n: failed.length });
    tone = theme.colors.error;
    onPress = () => router.push('/(shared)/outbox' as any);
  } else if (sentJob) {
    text = t('offline.requestSent');
    tone = theme.colors.success;
    onPress = () => { const id = sentJob; setSentJob(null); router.push(routes.customerJob(id) as any); };
  } else if (!online) {
    text = waiting.length ? t('offline.waiting', { n: waiting.length }) : t('offline.bar');
    if (waiting.length) onPress = () => router.push('/(shared)/outbox' as any); // see them, or remove one
  } else if (waiting.length) {
    text = t('offline.sending', { n: waiting.length });
    onPress = () => router.push('/(shared)/outbox' as any);
  }
  if (!text) return null;

  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ paddingTop: insets.top + 4, paddingBottom: 6, paddingHorizontal: 16, backgroundColor: tone }}>
      <TouchableOpacity disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={text} style={{ minHeight: 24, justifyContent: 'center' }}>
        <Text variant="bodySmall" weight="semibold" color={theme.colors.onPrimary} align="center">{text}</Text>
      </TouchableOpacity>
    </View>
  );
}
