import React from 'react';
import { View, TouchableOpacity, StyleSheet, TextInput as RNTextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { examplePhone, type CountryConfig } from '@fixli/shared';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';

export interface PhoneFieldProps {
  label: string;
  country: CountryConfig;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  onCountryPress: () => void;
  error?: string;
  autoFocus?: boolean;
  /** Only show the country chip as tappable when there is more than one country to choose. */
  canChangeCountry: boolean;
}

/** Country chip + number input that is masked for the selected country. */
export const PhoneField = ({
  label, country, value, onChangeText, onBlur, onCountryPress, error, autoFocus, canChangeCountry,
}: PhoneFieldProps) => {
  const theme = useTheme();
  const borderColor = error ? theme.colors.error : theme.colors.border;

  return (
    <View>
      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing.xs }}>
        {label}
      </Text>
      <View style={[styles.row, { borderColor, backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.lg }]}>
        <TouchableOpacity
          onPress={onCountryPress}
          disabled={!canChangeCountry}
          accessibilityRole="button"
          accessibilityLabel={`${country.name}, +${country.dialCode}`}
          accessibilityHint={canChangeCountry ? t('phoneField.doubleTapToChange') : undefined}
          style={[styles.chip, { borderEndColor: theme.colors.border }]}
          hitSlop={{ top: 8, bottom: 8 }}
        >
          <Text variant="bodyLarge">{country.flag}</Text>
          <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginStart: 6 }}>
            +{country.dialCode}
          </Text>
          {canChangeCountry && <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} style={{ marginStart: 4 }} />}
        </TouchableOpacity>
        <RNTextInput
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          autoFocus={autoFocus}
          placeholder={examplePhone(country.code)}
          placeholderTextColor={theme.colors.textTertiary}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoCorrect={false}
          maxLength={22}
          accessibilityLabel={label}
          testID="phone-input"
          style={[styles.input, { color: theme.colors.textPrimary, fontSize: 18, textAlign: 'left' }]}
        />
      </View>
      {error ? (
        <Text variant="caption" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: theme.spacing.xs }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, minHeight: 56, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, alignSelf: 'stretch', borderEndWidth: 1 },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, writingDirection: 'ltr' },
});
