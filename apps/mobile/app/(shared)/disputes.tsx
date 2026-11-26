import React, { useCallback } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';
import { useI18n } from '../../src/hooks/useI18n';
import { t } from '../../src/i18n';

const STATUS: Record<api.DisputeItem['status'], { text: () => string; tone: 'warning' | 'success' | 'textSecondary' }> = {
  OPEN: { text: () => t('disputes.status.open'), tone: 'warning' },
  IN_REVIEW: { text: () => t('disputes.status.review'), tone: 'warning' },
  RESOLVED: { text: () => t('disputes.status.resolved'), tone: 'success' },
  CLOSED: { text: () => t('disputes.status.closed'), tone: 'textSecondary' },
};

export default function DisputesScreen() {
  const theme = useTheme();
  useI18n(); // re-render when the language changes
  const { data, loading, error, reload } = useApi(api.getMyDisputes);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return (
    <Screen title={t('disputes.title')} back onRefresh={reload} refreshing={loading}>
      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon="flag-outline" title={t('disputes.empty.title')} message={t('disputes.empty.message')} />
      ) : data.map((d) => {
        const st = STATUS[d.status] ?? STATUS.OPEN;
        return (
          <TouchableOpacity
            key={d.id}
            onPress={() => router.push(`/(customer)/(home)/job/${d.jobRequestId}` as any)}
            accessibilityRole="button"
            accessibilityLabel={`${d.reason}. ${st.text()}`}
            style={{ padding: 16, marginBottom: 12, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ flex: 1 }}>{d.reason}</Text>
              <Text variant="bodySmall" weight="semibold" color={theme.colors[st.tone]}>{st.text()}</Text>
            </View>
            {d.description ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>{d.description}</Text> : null}
            {d.resolution ? (
              <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 8 }}>{t('disputes.answer', { text: d.resolution ?? '' })}</Text>
            ) : null}
            <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 8 }}>{new Date(d.createdAt).toLocaleDateString()}</Text>
          </TouchableOpacity>
        );
      })}
    </Screen>
  );
}
