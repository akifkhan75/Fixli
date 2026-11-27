import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { Button } from './Button';
import { useI18n } from '../../hooks/useI18n';
import { Entrance } from '../motion/Entrance';
import { SkeletonList } from '../motion/Skeleton';

function IconBubble({ name, color, tint }: { name: keyof typeof Ionicons.glyphMap; color: string; tint: string }) {
  return (
    <View style={[styles.bubble, { backgroundColor: tint }]}>
      <Ionicons name={name} size={40} color={color} />
    </View>
  );
}

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
}

/** Says what is missing and what to do next (doc 21 §15). */
export function EmptyState({ title, message, icon = 'file-tray-outline', actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.container} accessibilityRole="summary">
      <Entrance style={{ alignItems: 'center' }}>
        <IconBubble name={icon} color={theme.colors.primaryText} tint={theme.colors.primarySoft} />
      </Entrance>
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} align="center" style={{ marginTop: 16 }}>{title}</Text>
      {message ? <Text variant="body" color={theme.colors.textSecondary} align="center" style={{ marginTop: 6 }}>{message}</Text> : null}
      {actionLabel && onAction ? <View style={{ marginTop: 20, alignSelf: 'stretch' }}><Button title={actionLabel} onPress={onAction} variant="primary" size="lg" /></View> : null}
    </View>
  );
}

/** Skeleton cards by default; a spinner with words when the wait needs explaining. */
export function LoadingState({ message }: { message?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  if (!message) return <SkeletonList label={t('common.loading')} />;
  return (
    <View style={styles.container} accessible accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text variant="body" color={theme.colors.textSecondary} align="center" style={{ marginTop: 12 }}>{message}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.container} accessibilityRole="alert">
      <IconBubble name="cloud-offline-outline" color={theme.colors.errorText} tint={theme.colors.errorSoft} />
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} align="center" style={{ marginTop: 16 }}>{t('errorState.somethingWentWrong')}</Text>
      <Text variant="body" color={theme.colors.textSecondary} align="center" style={{ marginTop: 6 }}>{message}</Text>
      <View style={{ marginTop: 20, alignSelf: 'stretch' }}><Button title={t('sharedSos.tryAgain')} onPress={onRetry} variant="primary" size="lg" /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, alignItems: 'center', justifyContent: 'center', flex: 1 },
  bubble: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
});
