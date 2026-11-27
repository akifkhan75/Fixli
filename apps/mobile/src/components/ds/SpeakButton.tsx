import React, { useEffect, useState } from 'react';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { PressableScale } from '../motion/PressableScale';

const VOICE: Record<string, string> = { en: 'en-US', ur: 'ur-PK', ar: 'ar-SA' };

let voices: Promise<string[]> | undefined;
/** Languages this phone can speak; empty when it won't say (then we offer the button anyway). */
function spokenLanguages() {
  voices ??= Promise.resolve(Speech.getAvailableVoicesAsync?.())
    .then((v) => (v ?? []).map((x) => x.language.slice(0, 2).toLowerCase()))
    .catch(() => []);
  return voices;
}

/**
 * "Read this to me", for people who read with difficulty (docs/22). Tap again to stop. Hidden when
 * the phone has no voice for the language, rather than staying silent when pressed.
 */
export function SpeakButton({ text, size = 48 }: { text: string; size?: number }) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let alive = true;
    spokenLanguages().then((all) => { if (alive) setAvailable(!all.length || all.includes(locale)); });
    return () => { alive = false; };
  }, [locale]);
  // Leaving the screen stops the voice.
  useEffect(() => () => { void Speech.stop(); }, []);

  if (!available) return null;

  const toggle = () => {
    void Speech.stop();
    if (speaking) { setSpeaking(false); return; }
    setSpeaking(true);
    const done = () => setSpeaking(false);
    Speech.speak(text, { language: VOICE[locale] ?? 'en-US', rate: 0.9, onDone: done, onStopped: done, onError: done });
  };

  return (
    <PressableScale
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={speaking ? t('speak.stop') : t('speak.listen')}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: speaking ? theme.colors.primary : theme.colors.primarySoft }}
    >
      <Ionicons name={speaking ? 'stop' : 'volume-high'} size={size * 0.5} color={speaking ? theme.colors.onPrimary : theme.colors.primaryText} />
    </PressableScale>
  );
}
