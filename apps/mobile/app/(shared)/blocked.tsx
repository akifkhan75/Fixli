import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { Avatar } from '../../src/components/ds/Avatar';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';

/** People you blocked: no chat, requests or prices between you. Unblock here. */
export default function BlockedScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getBlocked);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | undefined>();
  if (loading && !data) return <Screen title="Blocked" back><LoadingState /></Screen>;
  if (error && !data) return <Screen title="Blocked" back><ErrorState message={error} onRetry={reload} /></Screen>;
  return (
    <Screen title="Blocked" back onRefresh={reload} refreshing={loading}>
      {!data?.length ? <EmptyState icon="shield-checkmark-outline" title="Nobody blocked" message="If you block someone from a chat, they appear here." /> : null}
      {err ? <Text variant="bodySmall" color={theme.colors.error}>{err}</Text> : null}
      {data?.map((b) => (
        <View key={b.blockedId} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 14, marginBottom: 10 }}>
          <Avatar name={b.blocked.name} imageUrl={b.blocked.profileImageUrl} size="md" />
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ flex: 1, marginStart: 12 }}>{b.blocked.name}</Text>
          <Button title="Unblock" variant="secondary" loading={busy === b.blockedId} disabled={!!busy}
            onPress={async () => { setBusy(b.blockedId); setErr(undefined); try { await api.unblock(b.blockedId); await reload(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(null); } }} />
        </View>
      ))}
    </Screen>
  );
}
