import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { t } from '../../i18n';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { Button } from './Button';

interface Props {
  /** Number shown to the user, already formatted. */
  phoneLabel: string;
  /** Seconds before another code may be requested (from the server). */
  resendSeconds: number;
  loading: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onChangeNumber?: () => void;
  onChangeCode?: () => void;
}

/** Six-digit code entry with SMS autofill and a resend countdown. Shared by signup and password reset. */
export function OtpCodeStep({ phoneLabel, resendSeconds, loading, error, submitLabel, onSubmit, onResend, onChangeNumber, onChangeCode }: Props) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(resendSeconds);

  useEffect(() => { setLeft(resendSeconds); }, [resendSeconds]);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const set = (v: string) => { onChangeCode?.(); setCode(v.replace(/\D/g, '').slice(0, 6)); };

  return (
    <View>
      <Text variant="bodyLarge" color={theme.colors.textSecondary} style={{ marginBottom: 20 }}>
        {t('auth.otpSent').replace('{phone}', phoneLabel)}
      </Text>
      <TextInput
        label={t('auth.otpLabel')}
        value={code}
        onChangeText={set}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        returnKeyType="go"
        onSubmitEditing={() => code.length === 6 && onSubmit(code)}
        accessibilityLabel={t('auth.otpLabel')}
      />
      {error ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 12 }}>{error}</Text> : null}
      <View style={{ marginTop: 24 }}>
        <Button title={submitLabel} variant="primary" size="lg" loading={loading} disabled={loading || code.length !== 6} onPress={() => onSubmit(code)} />
      </View>
      <View style={{ alignItems: 'center', marginTop: 20 }}>
        {left > 0 ? (
          <Text variant="body" color={theme.colors.textTertiary}>{t('auth.otpResendIn').replace('{s}', String(left))}</Text>
        ) : (
          <TouchableOpacity onPress={() => { setCode(''); onResend(); }} accessibilityRole="button" style={{ paddingVertical: 8 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text variant="body" weight="bold" color={theme.colors.primary}>{t('auth.otpResend')}</Text>
          </TouchableOpacity>
        )}
        {onChangeNumber ? (
          <TouchableOpacity onPress={onChangeNumber} accessibilityRole="button" style={{ paddingVertical: 8 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text variant="body" color={theme.colors.textSecondary}>{t('auth.otpChange')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
