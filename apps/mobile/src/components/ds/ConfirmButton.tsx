import React, { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { Button, type ButtonVariant } from './Button';
import { Text } from './Text';

/**
 * For steps that move money or can't be undone: the first tap asks, in a plain sentence, and the
 * second does it.
 */
export function ConfirmButton({ title, question, confirmTitle, variant = 'primary', busy, disabled, onConfirm }: {
  title: string; question: string; confirmTitle?: string; variant?: ButtonVariant; busy?: boolean; disabled?: boolean; onConfirm: () => void | Promise<unknown>;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);

  if (!asking) return <Button title={title} variant={variant} size="lg" disabled={disabled || busy} loading={busy} onPress={() => setAsking(true)} />;

  return (
    <Animated.View entering={FadeIn.duration(theme.motion.duration.base).reduceMotion(ReduceMotion.System)} accessibilityRole="alert"
      style={{ backgroundColor: variant === 'danger' ? theme.colors.errorSoft : theme.colors.primarySoft, borderRadius: theme.borderRadius.xl, padding: theme.spacing.lg }}>
      <Text variant="bodyLarge" weight="semibold">{question}</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
        <View style={{ flex: 1 }}><Button title={t('authSignup.back')} variant="secondary" disabled={busy} onPress={() => setAsking(false)} /></View>
        <View style={{ flex: 1 }}><Button title={confirmTitle ?? title} variant={variant === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={busy} onPress={() => { setAsking(false); void onConfirm(); }} /></View>
      </View>
    </Animated.View>
  );
}
