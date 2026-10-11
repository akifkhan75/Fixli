import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { TextInput } from '../../src/components/ds/TextInput';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { SOS_COPY as C } from '../../src/safety/copy';
import * as api from '../../src/services/api';

/** People to text if you press SOS for an emergency involving you. */
export default function TrustedContactsScreen() {
  const theme = useTheme();
  const { data, loading, error, reload } = useApi(api.getTrustedContacts);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  if (loading && !data) return <Screen title={C.contactsTitle} back><LoadingState /></Screen>;
  if (error && !data) return <Screen title={C.contactsTitle} back><ErrorState message={error} onRetry={reload} /></Screen>;
  const add = async () => {
    setBusy(true); setErr(undefined);
    try { await api.addTrustedContact(name.trim(), phone.trim()); setName(''); setPhone(''); await reload(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Screen title={C.contactsTitle} back onRefresh={reload} refreshing={loading}>
      <Text variant="body" color={theme.colors.textSecondary}>{C.contactsBody}</Text>
      {!data?.length ? <EmptyState icon="people-outline" title="No trusted contacts" message="Add a family member or friend." /> : null}
      {data?.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 14, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{c.name}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{c.phone}</Text>
          </View>
          <Button title="Remove" variant="ghost" onPress={async () => { await api.removeTrustedContact(c.id).catch(() => undefined); await reload(); }} />
        </View>
      ))}
      {(data?.length ?? 0) < 5 ? (
        <View style={{ gap: 10, marginTop: 20 }}>
          <TextInput label="Name" value={name} onChangeText={setName} maxLength={100} />
          <TextInput label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={30} />
          {err ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert">{err}</Text> : null}
          <Button title="Add contact" variant="primary" loading={busy} disabled={busy || !name.trim() || phone.trim().length < 7} onPress={add} />
        </View>
      ) : null}
    </Screen>
  );
}
