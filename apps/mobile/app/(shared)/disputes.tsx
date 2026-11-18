import React, { useCallback } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';

const STATUS: Record<api.DisputeItem['status'], { text: string; tone: 'warning' | 'success' | 'textSecondary' }> = {
  OPEN: { text: 'Received', tone: 'warning' },
  IN_REVIEW: { text: 'Being looked at', tone: 'warning' },
  RESOLVED: { text: 'Resolved', tone: 'success' },
  CLOSED: { text: 'Closed', tone: 'textSecondary' },
};

export default function DisputesScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getMyDisputes);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return (
    <Screen title="My reports" back onRefresh={reload} refreshing={loading}>
      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState icon="flag-outline" title="No reports" message="If a job goes wrong, open it and tap “Report a problem”." />
      ) : data.map((d) => {
        const st = STATUS[d.status] ?? STATUS.OPEN;
        return (
          <TouchableOpacity
            key={d.id}
            onPress={() => router.push(`/(customer)/job/${d.jobRequestId}` as any)}
            accessibilityRole="button"
            accessibilityLabel={`${d.reason}. ${st.text}`}
            style={{ padding: 16, marginBottom: 12, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ flex: 1 }}>{d.reason}</Text>
              <Text variant="bodySmall" weight="semibold" color={theme.colors[st.tone]}>{st.text}</Text>
            </View>
            {d.description ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>{d.description}</Text> : null}
            {d.resolution ? (
              <Text variant="body" color={theme.colors.textPrimary} style={{ marginTop: 8 }}>Our answer: {d.resolution}</Text>
            ) : null}
            <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 8 }}>{new Date(d.createdAt).toLocaleDateString()}</Text>
          </TouchableOpacity>
        );
      })}
    </Screen>
  );
}
