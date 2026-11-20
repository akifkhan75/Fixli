import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { Button } from './Button';
import { t } from '../../i18n';

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
      <Ionicons name={icon} size={44} color={theme.colors.textTertiary} />
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} align="center" style={{ marginTop: 16 }}>{title}</Text>
      {message ? <Text variant="body" color={theme.colors.textSecondary} align="center" style={{ marginTop: 6 }}>{message}</Text> : null}
      {actionLabel && onAction ? <View style={{ marginTop: 20, alignSelf: 'stretch' }}><Button title={actionLabel} onPress={onAction} variant="primary" size="lg" /></View> : null}
    </View>
  );
}

export function LoadingState({ message }: { message?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      {message ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 12 }}>{message}</Text> : null}
    </View>
  );
}

import { useI18n } from '../../hooks/useI18n';

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={44} color={theme.colors.textTertiary} />
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} align="center" style={{ marginTop: 16 }}>{t('errorState.somethingWentWrong')}</Text>
      <Text variant="body" color={theme.colors.textSecondary} align="center" style={{ marginTop: 6 }}>{message}</Text>
      <View style={{ marginTop: 20, alignSelf: 'stretch' }}><Button title={t('sharedSos.tryAgain')} onPress={onRetry} variant="primary" size="lg" /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, alignItems: 'center', justifyContent: 'center', flex: 1 },
});
