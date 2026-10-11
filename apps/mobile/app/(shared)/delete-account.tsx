import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../src/hooks/useTheme';
import { friendlyError } from '../../src/hooks/useApi';
import { useAppDispatch } from '../../src/hooks/useRedux';
import { sessionExpired } from '../../src/store/authSlice';
import { clearTokens } from '../../src/services/session';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { PasswordField } from '../../src/components/ds/PasswordField';
import * as api from '../../src/services/api';

/** Delete my account (store requirement). Explains what happens, asks for the password. */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteAccount(password);
      await clearTokens();
      dispatch(sessionExpired());
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };

  return (
    <Screen title="Delete account" back>
      <Text variant="body" color={theme.colors.textPrimary}>Deleting your account:</Text>
      <View style={{ gap: 6, marginTop: 8 }}>
        {[
          'signs you out on every phone',
          'removes your name, number, photo, addresses and saved professionals',
          'cancels requests that are still open',
          'keeps payment records (without your name) for as long as the law requires',
        ].map((t) => <Text key={t} variant="body" color={theme.colors.textSecondary}>• {t}</Text>)}
      </View>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 12 }}>
        You can't delete it during a job or while you owe Fixli money. You can sign up again later with the same number.
      </Text>
      <View style={{ marginTop: 20 }}>
        <PasswordField label="Your password" value={password} onChangeText={setPassword} />
      </View>
      {error ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 8 }}>{error}</Text> : null}
      <View style={{ marginTop: 20 }}>
        <Button title="Delete my account" variant="danger" size="lg" loading={busy} disabled={busy || !password} onPress={remove} />
      </View>
    </Screen>
  );
}
