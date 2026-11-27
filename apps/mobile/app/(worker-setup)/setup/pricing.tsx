import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../../src/hooks/useTheme';
import { useI18n } from '../../../src/hooks/useI18n';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { useSetupNext } from '../../../src/hooks/useSetupNext';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { ChoiceCard } from '../../../src/components/ds/ChoiceCard';
import { AmountField, toMajorText } from '../../../src/components/ds/AmountField';
import { StepHeader } from '../../../src/components/ds/StepHeader';
import { LoadingState } from '../../../src/components/ds/EmptyState';
import { Entrance } from '../../../src/components/motion/Entrance';
import { parseMajorToMinor } from '../../../src/utils/money';
import * as api from '../../../src/services/api';

/** Three choices a person can answer. "After I see it" covers both quote models: with or without a visit fee. */
type Choice = 'fixed' | 'hourly' | 'inspect';

const QUICK = { fee: [500, 1000, 1500, 2000], hour: [500, 800, 1000, 1500] };

export default function PricingScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const goNext = useSetupNext();
  const me = useApi(api.getWorkerMe);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [fee, setFee] = useState('');
  const [rate, setRate] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const currency = me.data?.currency ?? 'PKR';
  useEffect(() => {
    const w = me.data;
    if (!w) return;
    if (w.pricingModel) setChoice(w.pricingModel === 'FIXED' ? 'fixed' : w.pricingModel === 'HOURLY' ? 'hourly' : 'inspect');
    if (w.minimumCallOutFee && w.pricingModel !== 'QUOTE') setFee(toMajorText(w.minimumCallOutFee, w.currency));
    if (w.hourlyRate) setRate(toMajorText(w.hourlyRate, w.currency));
  }, [me.data]);

  if (me.loading && !me.data) return <Screen title={t('workerSetup.yourPrices')} back><LoadingState /></Screen>;

  const feeMinor = parseMajorToMinor(fee, currency);
  const rateMinor = parseMajorToMinor(rate, currency);
  const feeError = submitted && choice === 'fixed' && !feeMinor ? t('workerSetupPricing.enterAmount') : undefined;
  const rateError = submitted && choice === 'hourly' && !rateMinor ? t('workerSetupPricing.enterAmount') : undefined;
  const quick = (list: number[]) => (currency === 'PKR' ? list : []);

  const save = async () => {
    setSubmitted(true);
    if (!choice || (choice === 'fixed' && !feeMinor) || (choice === 'hourly' && !rateMinor)) return;
    setSaving(true);
    setError(undefined);
    try {
      const patch: api.WorkerPatch = choice === 'fixed' ? { pricingModel: 'FIXED', minimumCallOutFee: feeMinor! }
        : choice === 'hourly' ? { pricingModel: 'HOURLY', hourlyRate: rateMinor! }
        : feeMinor ? { pricingModel: 'CALLOUT_PLUS_QUOTE', minimumCallOutFee: feeMinor } : { pricingModel: 'QUOTE' };
      goNext(await api.patchWorkerMe(patch));
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <Screen title={t('workerSetup.yourPrices')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving || !choice} onPress={save} />}>
      <StepHeader question={t('workerSetupPricing.howDoYouCharge')} />
      <ChoiceCard speak icon="pricetag" title={t('workerSetupPricing.fixed')} hint={t('workerSetupPricing.fixedHint')} selected={choice === 'fixed'} onPress={() => setChoice('fixed')} />
      <ChoiceCard speak icon="time" title={t('workerSetupPricing.perHour')} hint={t('workerSetupPricing.hourHint')} selected={choice === 'hourly'} onPress={() => setChoice('hourly')} />
      <ChoiceCard speak icon="eye" title={t('workerSetupPricing.afterSeeing')} hint={t('workerSetupPricing.afterSeeingHint')} selected={choice === 'inspect'} onPress={() => setChoice('inspect')} />

      {choice ? (
        <Entrance key={choice} style={{ marginTop: theme.spacing.lg }}>
          {choice === 'hourly'
            ? <AmountField label={t('workerSetupPricing.pricePerHour', { currency })} value={rate} onChangeText={setRate} currency={currency} quick={quick(QUICK.hour)} error={rateError} />
            : <AmountField label={choice === 'fixed' ? t('workerSetupPricing.startingPrice', { currency }) : t('workerSetupPricing.visitFeeOptional', { currency })} value={fee} onChangeText={setFee} currency={currency} quick={quick(QUICK.fee)} error={feeError} />}
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 10 }}>{t('workerSetupPricing.youCanSendA')}</Text>
        </Entrance>
      ) : null}
      <View>{error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}</View>
    </Screen>
  );
}
