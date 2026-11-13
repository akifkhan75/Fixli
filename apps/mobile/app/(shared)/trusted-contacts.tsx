import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { TextInput } from '../../src/components/ds/TextInput';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import * as api from '../../src/services/api';

const E164 = /^\+[1-9]\d{7,14}$/;

export default function TrustedContactsScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getTrustedContacts);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  const normalised = phone.replace(/[\s-]/g, '');
  const valid = name.trim().length > 0 && E164.test(normalised);

  const add = async () => {
    setBusy(true); setFormError(undefined);
    try {
      await api.addTrustedContact({ name: name.trim(), phone: normalised });
      setName(''); setPhone('');
      await reload();
    } catch (e) { setFormError(friendlyError(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try { await api.removeTrustedContact(id); await reload(); } catch (e) { setFormError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Trusted contacts" back>
      <Text variant="body" color={theme.colors.textSecondary}>
        If you press SOS we text these people your location. They do not need the app. We never tell anyone that the authorities were called: please call emergency services yourself.
      </Text>
      <View style={{ marginTop: 16 }}>
        {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
          <EmptyState icon="people-outline" title="No trusted contacts yet" message="Add someone who should know if you ever need urgent help." />
        ) : data.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surface }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{c.name}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ writingDirection: 'ltr' }}>{c.phone}</Text>
            </View>
            <TouchableOpacity disabled={busy} onPress={() => remove(c.id)} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} style={{ padding: 8 }}>
              <Ionicons name="trash-outline" size={22} color={theme.colors.error} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {(data?.length ?? 0) < 5 ? (
        <View style={{ marginTop: 20 }}>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 8 }}>Add a contact</Text>
          <TextInput label="Name" value={name} onChangeText={setName} maxLength={100} />
          <TextInput label="Phone (with country code)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+92 300 1234567" />
          {phone && !E164.test(normalised) ? <Text variant="bodySmall" color={theme.colors.error}>Start with the country code, for example +92 300 1234567.</Text> : null}
          {formError ? <Text variant="bodySmall" color={theme.colors.error}>{formError}</Text> : null}
          <View style={{ marginTop: 12 }}><Button title="Save contact" size="lg" variant="primary" loading={busy} disabled={busy || !valid} onPress={add} /></View>
        </View>
      ) : <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginTop: 12 }}>You have the maximum of 5 contacts.</Text>}
    </Screen>
  );
}
