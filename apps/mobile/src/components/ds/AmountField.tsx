import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { currencyExponent, formatMoney, parseMajorToMinor } from '../../utils/money';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { ChipChoice } from './ChipChoice';

/** Whole currency units as typed text <-> integer minor units. */
export const toMajorText = (minor: number, currency: string) => String(Math.round(minor / 10 ** currencyExponent(currency)));

/**
 * A money field: number pad, tappable common amounts, and the formatted value read back underneath
 * so a missing or extra zero is noticed.
 */
export function AmountField({ label, value, onChangeText, currency, quick = [], error, testID }: {
  label: string; value: string; onChangeText: (v: string) => void; currency: string;
  /** Suggested amounts in whole units. */
  quick?: number[]; error?: string; testID?: string;
}) {
  const theme = useTheme();
  const { locale } = useI18n();
  const minor = parseMajorToMinor(value, currency);
  return (
    <View>
      <TextInput testID={testID} label={label} keyboardType="number-pad" value={value} onChangeText={(v) => onChangeText(v.replace(/[^\d,]/g, '').slice(0, 11))} error={error} style={{ fontSize: theme.fontSize['2xl'] }} />
      {minor ? <Text variant="bodySmall" weight="semibold" color={theme.colors.primaryText} style={{ marginTop: 4 }}>{formatMoney(minor, currency, locale)}</Text> : null}
      {quick.length ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <ChipChoice
            options={quick.map((q) => ({ id: String(q), label: formatMoney(q * 10 ** currencyExponent(currency), currency, locale) }))}
            selectedIds={[value]}
            onChange={(ids) => ids[0] && onChangeText(ids[0])}
          />
        </View>
      ) : null}
    </View>
  );
}
