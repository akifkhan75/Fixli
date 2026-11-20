import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { LoadingState } from '../../../src/components/ds/EmptyState';
import { parseMajorToMinor } from '../../../src/utils/money';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

type Model = NonNullable<api.WorkerMe['pricingModel']>;
const MODELS = (): { id: Model; label: string }[] => ([
  { id: 'CALLOUT_PLUS_QUOTE', label: t('workerSetupPricing.visitFeeThenA') },
  { id: 'FIXED', label: t('workerSetupPricing.fixedPrices') },
  { id: 'HOURLY', label: t('workerSetupPricing.perHour') },
  { id: 'QUOTE', label: t('workerSetupPricing.quoteAfterInspection') },
]);

export default function PricingScreen() {
  const theme = useTheme();
  const me = useApi(api.getWorkerMe);
  const [model, setModel] = useState<string[]>([]);
  const [fee, setFee] = useState('');
  const [rate, setRate] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const currency = me.data?.currency ?? 'PKR';
  useEffect(() => {
    const w = me.data;
    if (!w) return;
    if (w.pricingModel) setModel([w.pricingModel]);
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: w.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    if (w.minimumCallOutFee) setFee(String(w.minimumCallOutFee / 10 ** digits));
    if (w.hourlyRate) setRate(String(w.hourlyRate / 10 ** digits));
  }, [me.data]);

  if (me.loading && !me.data) return <Screen title={t('workerSetup.yourPrices')} back><LoadingState /></Screen>;

  const m = model[0] as Model | undefined;
  const needsFee = m === 'CALLOUT_PLUS_QUOTE' || m === 'FIXED';
  const needsRate = m === 'HOURLY';
  const feeMinor = parseMajorToMinor(fee, currency);
  const rateMinor = parseMajorToMinor(rate, currency);
  const feeError = submitted && needsFee && !feeMinor ? 'Enter an amount, for example 1500.' : undefined;
  const rateError = submitted && needsRate && !rateMinor ? 'Enter an amount, for example 800.' : undefined;

  const save = async () => {
    setSubmitted(true);
    if (!m || (needsFee && !feeMinor) || (needsRate && !rateMinor)) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.patchWorkerMe({
        pricingModel: m,
        ...(needsFee && feeMinor ? { minimumCallOutFee: feeMinor } : {}),
        ...(needsRate && rateMinor ? { hourlyRate: rateMinor } : {}),
      });
      router.back();
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <Screen title={t('workerSetup.yourPrices')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving || !m} onPress={save} />}>
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>{t('workerSetupPricing.howDoYouCharge')}</Text>
      <ChipChoice options={MODELS()} selectedIds={model} onChange={setModel} />
      {needsFee ? (
        <View style={{ marginTop: 24 }}><TextInput label={m === 'FIXED' ? t('workerSetupPricing.startingPrice', { currency }) : t('workerSetupPricing.visitFee', { currency })} keyboardType="number-pad" value={fee} onChangeText={setFee} error={feeError} /></View>
      ) : null}
      {needsRate ? (
        <View style={{ marginTop: 24 }}><TextInput label={t('workerSetupPricing.pricePerHour', { currency })} keyboardType="number-pad" value={rate} onChangeText={setRate} error={rateError} /></View>
      ) : null}
      {m ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 10 }}>{t('workerSetupPricing.youCanSendA')}</Text> : null}
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
