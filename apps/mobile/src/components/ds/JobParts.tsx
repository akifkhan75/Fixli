import React from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import type { JobEventView, JobMediaView } from '../../services/api';
import { eventSentence, type Viewer } from '../../utils/jobStatus';
import { useI18n } from '../../hooks/useI18n';
import { t } from '../../i18n';

/** Photos (horizontal) and the voice note with its transcript. Links are short-lived and signed. */
export function JobMedia({ media }: { media: JobMediaView[] }) {
  const theme = useTheme();
  const { t } = useI18n();
  const photos = media.filter((m) => m.kind === 'PHOTO');
  const voice = media.find((m) => m.kind === 'AUDIO');
  const player = useAudioPlayer(voice?.url ?? null);
  if (!photos.length && !voice) return null;
  return (
    <View style={{ marginTop: 20 }}>
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {photos.map((p) => <Image key={p.id} source={{ uri: p.url }} accessibilityLabel={t('customerRequestService.photoOfTheProblem')} style={{ width: 160, height: 120, borderRadius: 12, marginEnd: 8, backgroundColor: theme.colors.surface }} />)}
        </ScrollView>
      ) : null}
      {voice ? (
        <TouchableOpacity onPress={() => { player.seekTo(0); player.play(); }} accessibilityRole="button" accessibilityLabel={t('jobParts.playTheVoiceNote')}
          style={{ marginTop: 12, backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="play-circle" size={28} color={theme.colors.primary} />
            <Text variant="body" weight="medium" color={theme.colors.textPrimary} style={{ marginStart: 8 }}>{t('job.voiceNote')}</Text>
          </View>
          {voice.transcript ? <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>"{voice.transcript}"</Text> : null}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** What actually happened, in order, from the server's event log. */
export function JobHistory({ events, viewer, locale }: { events: JobEventView[]; viewer: Viewer; locale?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  if (!events.length) return null;
  return (
    <View style={{ marginTop: 24 }}>
      <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginBottom: 8 }}>{t('job.history')}</Text>
      {events.map((e, i) => (
        <View key={e.id} style={{ flexDirection: 'row' }}>
          <View style={{ alignItems: 'center', width: 20 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: i === events.length - 1 ? theme.colors.primary : theme.colors.border }} />
            {i < events.length - 1 ? <View style={{ width: 2, flex: 1, backgroundColor: theme.colors.border }} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: 14, marginStart: 8 }}>
            <Text variant="body" color={theme.colors.textPrimary}>{eventSentence(e.type, viewer, e.payload)}</Text>
            <Text variant="caption" color={theme.colors.textTertiary}>{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(e.createdAt))}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
