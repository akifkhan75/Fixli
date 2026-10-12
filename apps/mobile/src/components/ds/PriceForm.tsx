import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { ChipChoice } from './ChipChoice';
import { currencyExponent, formatMoney, parseMajorToMinor } from '../../utils/money';
import { useI18n } from '../../hooks/useI18n';
import { t } from '../../i18n';

const ETAS = () => ([{ id: '30', label: t('priceForm.30Min') }, { id: '60', label: t('priceForm.1Hour') }, { id: '120', label: t('priceForm.2Hours') }, { id: '240', label: t('priceForm.4Hours') }, { id: '1440', label: t('customerRequestService.tomorrow') }]);

/**
 * "Send my price": numeric keypad + quick picks around the worker's usual fee, arrival time
 * chips, optional note (doc 22 §6.3 D). Amounts are integer minor units end to end.
 */
export function PriceForm({ currency, usualMinor, initialMinor, initialEta, locale, busy, onSubmit, submitLabel = 'Send price' }: {
  currency: string; usualMinor?: number | null; initialMinor?: number; initialEta?: number | null; locale: string; busy?: boolean;
  onSubmit: (amountMinor: number, etaMinutes: number | undefined, note: string | undefined) => void; submitLabel?: string;
  }) {
  const theme = useTheme();
  const { t } = useI18n();
  const digits = useMemo(() => currencyExponent(currency), [currency]);
  const toMajor = (minor: number) => String(Math.round(minor / 10 ** digits));
  const [text, setText] = useState(initialMinor ? toMajor(initialMinor) : '');
  const [eta, setEta] = useState<string[]>(initialEta ? [String(initialEta)] : ['60']);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const minor = parseMajorToMinor(text, currency);
  const quick = usualMinor ? [0.8, 1, 1.25, 1.5].map((f) => Math.round((usualMinor * f) / 10 ** digits / 50) * 50 * 10 ** digits) : [];

  return (
    <View>
      <TextInput label={t('priceForm.yourPrice', { currency })} keyboardType="number-pad" value={text} onChangeText={(v) => setText(v.replace(/[^\d,]/g, ''))}
        error={submitted && !minor ? t('priceForm.enterYourPriceFor') : undefined} style={{ fontSize: 24 }} />
      {minor ? <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>{t('priceForm.customerSees', { price: formatMoney(minor, currency, locale) })}</Text> : null}
      {quick.length ? (
        <View style={{ marginTop: 12 }}>
          <ChipChoice options={[...new Set(quick)].filter((q) => q > 0).map((q) => ({ id: String(q), label: formatMoney(q, currency, locale) }))}
            selectedIds={minor ? [String(minor)] : []} onChange={(ids) => ids[0] && setText(toMajor(Number(ids[0])))} />
        </View>
      ) : null}
      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 20, marginBottom: 8 }}>{t('worker.etaPrefix')}</Text>
      <ChipChoice options={ETAS()} selectedIds={eta} onChange={setEta} />
      <View style={{ marginTop: 16 }}>
        <TextInput label={t('priceForm.noteForTheCustomer')} placeholder={t('priceForm.eGPriceIncludes')} value={note} onChangeText={setNote} maxLength={300} />
      </View>
      <View style={{ marginTop: 20 }}>
        <Button title={submitLabel} variant="primary" size="lg" loading={busy} disabled={busy}
          onPress={() => { setSubmitted(true); if (minor) onSubmit(minor, eta[0] ? Number(eta[0]) : undefined, note.trim() || undefined); }} />
      </View>
    </View>
  );
}
