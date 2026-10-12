import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';
import { DirIcon } from './DirIcon';

interface ScreenProps {
  title?: string;
  /** Show a back arrow (for pushed screens). */
  back?: boolean;
  /** Sticky bottom area, e.g. the primary button. */
  footer?: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}

/** Consistent screen frame: safe area, title row, optional back, scrolling body, sticky footer. */
export function Screen({ title, back, footer, scroll = true, refreshing, onRefresh, children }: ScreenProps) {
  const theme = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 32, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: 20 }}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      {(title || back) && (
        <View style={styles.header}>
          {back ? (
            <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('authSignup.back')} style={styles.back} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <DirIcon name="arrow-back" size={26} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          ) : null}
          {title ? <Text variant="h2" weight="bold" color={theme.colors.textPrimary} style={{ flex: 1 }} accessibilityRole="header">{title}</Text> : null}
        </View>
      )}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer ? <View style={[styles.footer, { borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, minHeight: 56 },
  back: { width: 44, height: 44, justifyContent: 'center', marginStart: -8 },
  footer: { padding: 20, borderTopWidth: StyleSheet.hairlineWidth },
});
