import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import { Text } from '../../components/ds/Text';
import { TextInput } from '../../components/ds/TextInput';
import { uploadAudio } from '../../services/upload';
import { transcribeVoice } from '../../services/api';
import { openSettings } from '../../services/pickPhoto';
import { useI18n } from '../../hooks/useI18n';
import { t } from '../../i18n';

const MAX_MS = 60_000;
const MIN_MS = 800;

export interface VoiceValue {
  audioUploadId?: string;
  /** Local file, so the person can listen back before sending. */
  audioUri?: string;
  transcript: string;
}

interface VoiceFieldProps {
  value: VoiceValue;
  onChange: (v: VoiceValue) => void;
  locale?: string;
  label?: string;
}

/**
 * Hold to talk -> the recording is uploaded and the server turns it into text, which is shown
 * so the person can correct it (AI output is a suggestion). The recording itself is always kept
 * and sent to the professional, because dialect transcription is imperfect (doc 22 §6.4).
 */
export function VoiceField({ value, onChange, locale, label = 'Tell us in your own words' }: VoiceFieldProps) {
  const theme = useTheme();
  const { t } = useI18n();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 200);
  const player = useAudioPlayer(value.audioUri ?? null);
  const [busy, setBusy] = useState<'upload' | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [denied, setDenied] = useState(false);
  const startedAt = useRef(0);

  // Hard stop at 60 s so recordings stay short and cheap to transcribe.
  useEffect(() => {
    if (rec.isRecording && rec.durationMillis >= MAX_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.durationMillis, rec.isRecording]);

  const start = async () => {
    setError(undefined);
    setDenied(false);
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setDenied(true);
      setError(t('voiceField.microphoneAccessIsOff'));
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  };

  const stop = async () => {
    if (!recorder.isRecording) return;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const uri = recorder.uri;
    if (!uri || Date.now() - startedAt.current < MIN_MS) {
      setError(t('voiceField.keepHoldingTheButton'));
      return;
    }
    setBusy('upload');
    try {
      const { id } = await uploadAudio(uri);
      onChange({ ...value, audioUploadId: id, audioUri: uri });
      try {
        const { text } = await transcribeVoice(id, locale);
        onChange({ audioUploadId: id, audioUri: uri, transcript: text || value.transcript });
        if (!text) setError(t('voiceField.weCouldntHearAny'));
      } catch (e) {
        // The recording still goes to the professional; only the text is missing.
        setError(t('voiceField.yourRecordingIsStill', { error: friendlyError(e) }));
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = () => onChange({ transcript: '', audioUploadId: undefined, audioUri: undefined });
  const seconds = Math.floor(rec.durationMillis / 1000);

  return (
    <View>
      <Text variant="body" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>{label}</Text>

      {!value.audioUploadId ? (
        <Pressable
          onPressIn={start}
          onPressOut={stop}
          disabled={!!busy}
          accessibilityRole="button"
          accessibilityLabel={t('voiceField.holdToRecordA')}
          accessibilityHint={t('voiceField.pressAndHoldSpeak')}
          style={[styles.hold, { backgroundColor: rec.isRecording ? theme.colors.error + '18' : theme.colors.surface, borderColor: rec.isRecording ? theme.colors.error : theme.colors.border }]}
        >
          {busy ? <ActivityIndicator color={theme.colors.primary} /> : (
            <Ionicons name={rec.isRecording ? 'radio-button-on' : 'mic'} size={34} color={rec.isRecording ? theme.colors.error : theme.colors.primary} />
          )}
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 8 }}>
            {busy ? t('voiceField.listeningToYourNote') : rec.isRecording ? t('voiceField.recordingSLetGo', { seconds }) : t('voiceField.holdToTalk')}
          </Text>
          {!rec.isRecording && !busy ? <Text variant="caption" color={theme.colors.textTertiary}>{t('voice.hint')}</Text> : null}
        </Pressable>
      ) : (
        <View style={[styles.done, { backgroundColor: theme.colors.surface }]}>
          <TouchableOpacity onPress={() => { player.seekTo(0); player.play(); }} accessibilityRole="button" accessibilityLabel={t('voiceField.playYourVoiceNote')} style={styles.row}>
            <Ionicons name="play-circle" size={30} color={theme.colors.primary} />
            <Text variant="body" weight="medium" color={theme.colors.textPrimary} style={{ marginStart: 8, flex: 1 }}>{t('voice.yourNote')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clear} accessibilityRole="button" accessibilityLabel={t('voiceField.deleteVoiceNoteAnd')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.errorText}>{t('voice.rerecord')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {value.audioUploadId ? (
        <View style={{ marginTop: 12 }}>
          <TextInput
            label={t('voiceField.whatWeHeardYou')}
            value={value.transcript}
            onChangeText={(t) => onChange({ ...value, transcript: t })}
            multiline
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />
        </View>
      ) : null}

      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 8 }}>{error}</Text> : null}
      {denied ? <TouchableOpacity onPress={openSettings} accessibilityRole="button" style={{ marginTop: 6 }}><Text variant="bodySmall" weight="semibold" color={theme.colors.primaryText}>{t('voice.openSettings')}</Text></TouchableOpacity> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hold: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 22, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  done: { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flex: 1 },
});
