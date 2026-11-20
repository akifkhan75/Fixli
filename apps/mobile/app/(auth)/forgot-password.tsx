import React, { useMemo, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { checkPassword, passwordIssueMessage } from '@fixli/shared';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useCountry } from '../../src/hooks/useCountry';
import { usePhoneInput } from '../../src/forms/usePhoneInput';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { PhoneField } from '../../src/components/ds/PhoneField';
import { PasswordField } from '../../src/components/ds/PasswordField';
import { CountryPicker } from '../../src/components/ds/CountryPicker';
import { OtpCodeStep } from '../../src/components/ds/OtpCodeStep';
import * as api from '../../src/services/api';
import { DirIcon } from '../../src/components/ds/DirIcon';

/** Forgot password: number -> texted code + new password -> back to sign in (every device is signed out). */
export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { country, config, countries, setCountry } = useCountry();
  const phone = usePhoneInput(country, setCountry, countries.map((c) => c.code));
  const [step, setStep] = useState<'phone' | 'reset' | 'done'>('phone');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(60);
  const [pickerOpen, setPickerOpen] = useState(false);

  const passwordIssue = useMemo(() => (password ? checkPassword(password, phone.result.e164)[0] : undefined), [password, phone.result.e164]);
  const passwordError = password.length >= 8 && passwordIssue ? passwordIssueMessage(passwordIssue) : undefined;

  const fail = (e: unknown) => setError(e instanceof api.ApiError ? e.message : t('auth.networkError'));

  const send = async () => {
    phone.touch();
    if (!phone.isValid) return;
    setBusy(true); setError(null);
    try {
      const r = await api.requestPasswordReset(phone.result.e164!, country);
      setResendSeconds(r.resendInSeconds);
      setStep('reset');
    } catch (e) {
      if (e instanceof api.ApiError && e.code === 'OTP_COOLDOWN') {
        setResendSeconds(Number((e.details as any)?.retryAfterSeconds) || 60);
        setStep('reset');
      } else fail(e);
    } finally { setBusy(false); }
  };

  const reset = async (code: string) => {
    if (!password || checkPassword(password, phone.result.e164).length) {
      setError(passwordIssue ? passwordIssueMessage(passwordIssue) : t('auth.passwordHint'));
      return;
    }
    setBusy(true); setError(null);
    try {
      await api.resetPassword(phone.result.e164!, country, code, password);
      setStep('done');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const back = () => (step === 'reset' ? setStep('phone') : router.back());

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: theme.spacing['2xl'] }]} keyboardShouldPersistTaps="handled">
        {step !== 'done' ? (
          <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.back} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <DirIcon name="arrow-back" size={28} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        ) : null}

        <Text variant="h1" weight="extrabold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>
          {step === 'reset' ? t('auth.otpTitle') : t('auth.forgotTitle')}
        </Text>

        {step === 'phone' ? (
          <View>
            <Text variant="bodyLarge" color={theme.colors.textSecondary} style={{ marginBottom: 24 }}>{t('auth.forgotSub')}</Text>
            <PhoneField
              label={t('auth.phone')}
              country={config}
              value={phone.text}
              onChangeText={(v) => { setError(null); phone.onChangeText(v); }}
              onBlur={phone.onBlur}
              onCountryPress={() => setPickerOpen(true)}
              canChangeCountry={countries.length > 1}
              error={phone.error}
              autoFocus
            />
            {error ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
            <View style={{ marginTop: 28 }}>
              <Button title={t('auth.forgotSend')} variant="primary" size="lg" loading={busy} disabled={busy} onPress={send} />
            </View>
          </View>
        ) : null}

        {step === 'reset' ? (
          <View>
            <View style={{ marginBottom: 20 }}>
              <PasswordField isNew label={t('auth.newPassword')} value={password} onChangeText={(v) => { setError(null); setPassword(v); }} error={passwordError} />
            </View>
            <OtpCodeStep
              phoneLabel={phone.text}
              resendSeconds={resendSeconds}
              loading={busy}
              error={error}
              submitLabel={t('auth.resetSubmit')}
              onSubmit={reset}
              onResend={send}
              onChangeNumber={() => setStep('phone')}
              onChangeCode={() => setError(null)}
            />
          </View>
        ) : null}

        {step === 'done' ? (
          <View>
            <Text variant="bodyLarge" color={theme.colors.textSecondary} style={{ marginBottom: 28 }}>{t('auth.resetDone')}</Text>
            <Button title={t('auth.signIn')} variant="primary" size="lg" onPress={() => router.replace('/(auth)/login' as any)} />
          </View>
        ) : null}
      </ScrollView>

      <CountryPicker
        visible={pickerOpen}
        title={t('auth.countryTitle')}
        countries={countries}
        selected={country}
        onSelect={(c) => { setCountry(c); phone.reformatFor(c); }}
        onClose={() => setPickerOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: 64, paddingBottom: 40 },
  back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 12 },
});
