import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import { Button } from './Button';
import { Text } from './Text';
import * as api from '../../services/api';

/**
 * "Call" while the job is booked (O7 default). The number is fetched only when tapped (each
 * reveal is recorded) and is never stored in the app.
 */
export function CallButton({ jobId, label }: { jobId: string; label: string }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const call = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const c = await api.getJobContact(jobId);
      if (!c.phone) setError('No phone number on file. Use the chat instead.');
      else await Linking.openURL(`tel:${c.phone}`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ marginTop: 12 }}>
      <Button title={label} variant="secondary" loading={busy} disabled={busy} onPress={call} leftIcon={<Ionicons name="call" size={20} color={theme.colors.textPrimary} />} />
      {error ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 6 }}>{error}</Text> : null}
    </View>
  );
}
