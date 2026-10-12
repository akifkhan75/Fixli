import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import { formatMoney, parseMajorToMinor } from '../../utils/money';
import * as api from '../../services/api';
import { ChipChoice } from './ChipChoice';
import { TextInput } from './TextInput';
import { Button } from './Button';
import { Text } from './Text';
import { t } from '../../i18n';

/**
 * "I paid Fixli": the worker sends what they owe by JazzCash / Easypaisa / bank, then reports the
 * amount and the transaction reference here. It counts once Fixli has checked it.
 */
export function SettleUpForm({ owed, currency, rails, locale, onDone }: {
  owed: number; currency: string; rails: api.Earnings['settlementRails']; locale: string; onDone: () => void;
}) {
  const theme = useTheme();
  const [rail, setRail] = useState<string[]>([]);
  const [amount, setAmount] = useState(String(owed / 100));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const minor = parseMajorToMinor(amount, currency);
  const chosen = rails.find((r) => r.id === rail[0]);

  const send = async () => {
    if (!minor || !rail[0]) return;
    setBusy(true);
    setError(undefined);
    try { await api.reportSettlement(minor, rail[0], reference.trim()); onDone(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      <Text variant="body" weight="semibold" color={theme.colors.textPrimary}>{t('settleUpForm.howDidYouPay')}</Text>
      <ChipChoice options={rails.map((r) => ({ id: r.id, label: r.label }))} selectedIds={rail} onChange={setRail} />
      {chosen ? (
        <Text variant="bodySmall" color={theme.colors.textSecondary}>
          {chosen.account ? t('settleUpForm.sendTo', { account: chosen.account }) : t('settleUpForm.askFixliSupportFor')}
        </Text>
      ) : null}
      <TextInput label={t('settleUpForm.amountYouPaid', { currency })} value={amount} onChangeText={setAmount} keyboardType="numeric" />
      {minor != null && minor > owed ? <Text variant="bodySmall" color={theme.colors.errorText}>{t('settleUp.moreThanOwed', { amount: formatMoney(owed, currency, locale) })}</Text> : null}
      <TextInput label={t('settleUpForm.transactionIdReference')} value={reference} onChangeText={setReference} placeholder={t('settleUpForm.eGJc778812')} autoCapitalize="characters" />
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{error}</Text> : null}
      <Button title={t('settleUpForm.sendForChecking')} variant="primary" loading={busy}
        disabled={busy || !rail[0] || !minor || minor > owed || reference.trim().length < 3} onPress={send} />
    </View>
  );
}
