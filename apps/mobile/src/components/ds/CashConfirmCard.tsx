import { analytics } from '../../services/analytics';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import * as api from '../../services/api';
import { Button } from './Button';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { t } from '../../i18n';

/** Customer: the professional says you paid cash. Yes, I paid / No, that's not right. */
export function CashConfirmCard({ payment, locale, onDone }: { payment: api.PaymentView; locale: string; onDone: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const amount = formatMoney(payment.amount, payment.currency, locale);
  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    setError(undefined);
    try { await fn(); onDone(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, marginTop: 12, gap: 10 }}>
      <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{t('cashConfirm.didYouPay', { amount })}</Text>
      <Text variant="body" color={theme.colors.textSecondary}>{t('cashConfirmCard.theProfessionalMarkedIt')}</Text>
      {!disputing ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Button title={t('cashConfirmCard.noThatsWrong')} variant="secondary" disabled={busy} onPress={() => setDisputing(true)} /></View>
          <View style={{ flex: 1 }}><Button title={t('cashConfirmCard.yesIPaid')} variant="primary" loading={busy} disabled={busy} onPress={act(async () => { await api.confirmPayment(payment.id); void analytics.track('payment_completed', { method: 'CASH' }); })} /></View>
        </View>
      ) : (
        <>
          <TextInput label={t('cashConfirmCard.whatsWrong')} value={reason} onChangeText={setReason} placeholder={t('cashConfirmCard.eGIPaid')} maxLength={500} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Button title={t('authSignup.back')} variant="secondary" disabled={busy} onPress={() => setDisputing(false)} /></View>
            <View style={{ flex: 1 }}><Button title={t('cashConfirmCard.tellFixli')} variant="danger" loading={busy} disabled={busy || reason.trim().length < 3} onPress={act(() => api.disputePayment(payment.id, reason.trim()))} /></View>
          </View>
        </>
      )}
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
