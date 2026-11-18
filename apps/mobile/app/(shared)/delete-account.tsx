import React, { useState } from 'react';
import { View } from 'react-native';
import { useAppDispatch } from '../../src/hooks/useRedux';
import { logoutUser } from '../../src/store/authSlice';
import { useTheme } from '../../src/hooks/useTheme';
import { friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { PasswordField } from '../../src/components/ds/PasswordField';
import * as api from '../../src/services/api';

const ERASED = [
  'Your name, phone number, email and photo',
  'Your saved addresses, trusted contacts and notifications',
  'Your documents, ID number and portfolio photos',
  'Your sign-in on every device',
];
const KEPT = [
  'Payment and fee records, without your name (the law requires them)',
  'Reviews you gave, without your comment',
  'Jobs you did with other people, shown as "Deleted user"',
];

export default function DeleteAccountScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  const erase = async () => {
    setBusy(true); setError(undefined);
    try {
      await api.deleteAccount(password);
      await dispatch(logoutUser()); // clears tokens and returns to the login screen
    } catch (e) {
      setError(friendlyError(e)); // e.g. "You have a job in progress. Finish or cancel it first."
      setConfirming(false);
    } finally { setBusy(false); }
  };

  return (
    <Screen
      title="Delete my account" back
      footer={confirming
        ? <View style={{ gap: 10 }}>
            <Text variant="body" weight="bold" color={theme.colors.error} style={{ textAlign: 'center' }}>This cannot be undone. Delete everything now?</Text>
            <Button title="Yes, delete my account" variant="danger" size="lg" loading={busy} disabled={busy} onPress={erase} />
            <Button title="No, keep my account" variant="secondary" size="lg" disabled={busy} onPress={() => setConfirming(false)} />
          </View>
        : <Button title="Delete my account" variant="danger" size="lg" disabled={!password || busy} onPress={() => setConfirming(true)} />}
    >
      <Text variant="body" color={theme.colors.textSecondary}>Deleting your account is permanent. Jobs that have not started are cancelled and the other person is told.</Text>
      <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginTop: 20 }}>WE ERASE</Text>
      {ERASED.map((t) => <Text key={t} variant="body" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>• {t}</Text>)}
      <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginTop: 16 }}>WE KEEP</Text>
      {KEPT.map((t) => <Text key={t} variant="body" color={theme.colors.textPrimary} style={{ marginTop: 4 }}>• {t}</Text>)}
      <View style={{ marginTop: 24 }}>
        <PasswordField label="Your password" value={password} onChangeText={(v) => { setPassword(v); setError(undefined); }} />
        {error ? <Text variant="body" weight="semibold" color={theme.colors.error} style={{ marginTop: 8 }}>{error}</Text> : null}
      </View>
    </Screen>
  );
}
