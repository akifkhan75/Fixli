import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { routes } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import * as api from '../../services/api';
import { Button } from './Button';
import { Text } from './Text';

/** Opens this job's chat (it exists from booking). */
export function MessageButton({ jobId, label }: { jobId: string; label: string }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const open = async () => {
    setBusy(true);
    setError(undefined);
    try { const c = await api.conversationForJob(jobId); router.push(routes.thread(c.id) as any); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ marginTop: 12 }}>
      <Button title={label} variant="secondary" loading={busy} disabled={busy} onPress={open} leftIcon={<Ionicons name="chatbubbles-outline" size={20} color={theme.colors.textPrimary} />} />
      {error ? <Text variant="bodySmall" color={theme.colors.error} style={{ marginTop: 6 }}>{error}</Text> : null}
    </View>
  );
}
