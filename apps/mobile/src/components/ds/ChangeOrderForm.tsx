import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { formatMoney, parseMajorToMinor } from '../../utils/money';
import { TextInput } from './TextInput';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Extra work found on site. The worker types the new total for the whole job in normal money
 * (e.g. 2500), never in paisa; the customer must approve before anything changes.
 */
export function ChangeOrderForm({ currentMinor, currency, locale, busy, onSubmit, onCancel }: {
  currentMinor: number | null;
  currency: string;
  locale: string;
  busy?: boolean;
  onSubmit: (v: { reason: string; addedScope: string; revisedPrice: number }) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('');
  const [total, setTotal] = useState('');
  const minor = parseMajorToMinor(total, currency);
  const same = minor != null && minor === currentMinor;

  return (
    <View style={{ marginTop: 20, backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, gap: 12 }}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>Extra work</Text>
      {currentMinor != null ? <Text variant="body" color={theme.colors.textSecondary}>Current price: {formatMoney(currentMinor, currency, locale)}</Text> : null}
      <TextInput label="What did you find?" value={reason} onChangeText={setReason} placeholder="e.g. The pipe behind the wall is cracked" />
      <TextInput label="What extra work is needed?" value={scope} onChangeText={setScope} placeholder="e.g. Replace 1 metre of pipe" />
      <TextInput label={`New total for the whole job (${currency})`} value={total} onChangeText={setTotal} keyboardType="numeric" placeholder="e.g. 2500" />
      {minor != null ? <Text variant="bodySmall" color={same ? theme.colors.error : theme.colors.textSecondary}>{same ? 'That is the same as the current price.' : `The customer will see: ${formatMoney(minor, currency, locale)}`}</Text> : null}
      {total && minor == null ? <Text variant="bodySmall" color={theme.colors.error}>Enter an amount like 2500.</Text> : null}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" disabled={busy} onPress={onCancel} /></View>
        <View style={{ flex: 1 }}>
          <Button title="Ask the customer" variant="primary" loading={busy}
            disabled={busy || !reason.trim() || !scope.trim() || minor == null || same}
            onPress={() => minor != null && onSubmit({ reason: reason.trim(), addedScope: scope.trim(), revisedPrice: minor })} />
        </View>
      </View>
    </View>
  );
}
