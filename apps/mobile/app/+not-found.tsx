import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Link, Stack } from 'expo-router';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../src/theme';
import { t } from '../src/i18n';

export default function NotFoundScreen() {
  const theme = colors.dark;

  return (
    <>
      <Stack.Screen options={{ title: t('notFound.oops') }} />
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={styles.emoji}>🔍</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t('notFound.pageNotFound')}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t('notFound.thePageYoureLooking')}
        </Text>
        <Link href="/" asChild>
          <TouchableOpacity accessibilityRole="button" style={StyleSheet.flatten([styles.button, { backgroundColor: theme.primary }])}>
            <Text style={styles.buttonText}>{t('notFound.goHome')}</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emoji: { fontSize: 64, marginBottom: spacing.xl },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, marginBottom: spacing.sm },
  subtitle: { fontSize: fontSize.base, marginBottom: spacing['2xl'], textAlign: 'center' },
  button: { paddingHorizontal: spacing['2xl'], paddingVertical: spacing.lg, borderRadius: borderRadius.lg },
  buttonText: { color: '#FFF', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
