import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';

export default function DevicesScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getSessions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  const signOut = async (id: string) => {
    setBusyId(id);
    setActionError(undefined);
    try { await api.revokeSession(id); await reload(); } catch (e) { setActionError(friendlyError(e)); } finally { setBusyId(null); }
  };

  return (
    <Screen title={t('customerProfile.yourDevices')} back onRefresh={reload} refreshing={loading && !!data}>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 16 }}>{t('sharedDevices.theseDevicesAreSigned')}</Text>
      {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState title={t('sharedDevices.noDevices')} />
      ) : data.map((s) => (
        <View key={s.id} style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={s.platform === 'ios' || s.platform === 'android' ? 'phone-portrait-outline' : 'desktop-outline'} size={26} color={theme.colors.primary} />
            <View style={{ flex: 1, marginHorizontal: 14 }}>
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{s.deviceName ?? t('sharedDevices.unknownDevice')}{s.current ? t('sharedDevices.thisDevice') : ''}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('sharedDevices.lastActive', { date: new Date(s.lastUsedAt).toLocaleDateString() })}</Text>
            </View>
          </View>
          {!s.current ? <View style={{ marginTop: 12 }}><Button title={t('sharedDevices.signOutThisDevice')} variant="secondary" loading={busyId === s.id} disabled={!!busyId} onPress={() => signOut(s.id)} /></View> : null}
        </View>
      ))}
      {actionError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{actionError}</Text> : null}
    </Screen>
  );
}
