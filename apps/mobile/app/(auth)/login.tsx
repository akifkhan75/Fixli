import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useCountry } from '../../src/hooks/useCountry';
import { usePhoneInput } from '../../src/forms/usePhoneInput';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { Logo } from '../../src/components/ds/Logo';
import { PhoneField } from '../../src/components/ds/PhoneField';
import { PasswordField } from '../../src/components/ds/PasswordField';
import { CountryPicker } from '../../src/components/ds/CountryPicker';
import { OtpCodeStep } from '../../src/components/ds/OtpCodeStep';
import * as api from '../../src/services/api';
import { friendlyError } from '../../src/hooks/useApi';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { loginUser, loginWithCode, selectAuthError, selectIsAuthLoading, clearAuthError } from '../../src/store/authSlice';

export default function LoginScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const dispatch = useAppDispatch();
  const error = useAppSelector(selectAuthError);
  const loading = useAppSelector(selectIsAuthLoading);
  const { country, config, countries, setCountry } = useCountry();
  const phone = usePhoneInput(country, setCountry, countries.map((c) => c.code));
  const [password, setPassword] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // A texted code needs nothing remembered, so it is the way in unless the person prefers a password.
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [sent, setSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(60);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const clearError = () => { setSendError(null); if (error) dispatch(clearAuthError()); };

  const sendCode = async () => {
    phone.touch();
    if (!phone.isValid) return;
    clearError();
    setSending(true);
    try {
      const r = await api.startLoginCode(phone.result.e164!, country);
      setResendSeconds(r.resendInSeconds);
      setSent(true);
    } catch (e) {
      if (e instanceof api.ApiError && e.code === 'OTP_COOLDOWN') {
        // A code was sent a moment ago: go on and type it.
        setResendSeconds(Number((e.details as any)?.retryAfterSeconds) || 60);
        setSent(true);
      } else setSendError(friendlyError(e));
    } finally { setSending(false); }
  };

  const onSubmit = () => {
    phone.touch();
    if (!phone.isValid || !password) return;
    dispatch(loginUser({ phone: phone.result.e164!, countryCode: country, password }));
  };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: theme.spacing['2xl'], paddingVertical: theme.spacing['4xl'] }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Logo height={56} style={{ marginBottom: 32 }} />
          <Text variant="h1" weight="extrabold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>{t('auth.welcomeBack')}</Text>
          {/* Once the code is out, the entry step says what to do. */}
          {mode === 'code' && sent ? null : <Text variant="bodyLarge" color={theme.colors.textSecondary}>{mode === 'code' ? t('auth.codeSub') : t('auth.signinSub')}</Text>}
        </View>

        {mode === 'code' && sent ? (
          <OtpCodeStep
            phoneLabel={phone.text}
            resendSeconds={resendSeconds}
            loading={loading || sending}
            error={error ?? sendError}
            submitLabel={t('auth.signIn')}
            onSubmit={(code) => dispatch(loginWithCode({ phone: phone.result.e164!, countryCode: country, code }))}
            onResend={sendCode}
            onChangeNumber={() => { setSent(false); clearError(); }}
            onChangeCode={clearError}
          />
        ) : (
        <>
        <PhoneField
          label={t('auth.phone')}
          country={config}
          value={phone.text}
          onChangeText={(v) => { clearError(); phone.onChangeText(v); }}
          onBlur={phone.onBlur}
          onCountryPress={() => setPickerOpen(true)}
          canChangeCountry={countries.length > 1}
          error={phone.error}
          autoFocus
        />
        {mode === 'password' ? (
          <>
        <View style={{ height: 16 }} />
        <PasswordField
          label={t('auth.password')}
          value={password}
          onChangeText={(v) => { clearError(); setPassword(v); }}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />
          </>
        ) : null}

        {error || sendError ? (
          <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error || sendError}</Text>
        ) : null}

        {mode === 'password' ? <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password' as any)} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginTop: 12, paddingVertical: 8 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text variant="body" weight="bold" color={theme.colors.primaryText}>{t('auth.forgot')}</Text>
        </TouchableOpacity> : null}

        <View style={{ marginTop: 16, gap: 8 }}>
          {mode === 'code'
            ? <Button title={t('auth.sendMeCode')} variant="primary" size="lg" loading={sending} disabled={sending} onPress={sendCode} />
            : <Button title={t('auth.signIn')} variant="primary" size="lg" loading={loading} disabled={loading} onPress={onSubmit} />}
          <Button title={mode === 'code' ? t('auth.usePassword') : t('auth.useCode')} variant="ghost" onPress={() => { setMode(mode === 'code' ? 'password' : 'code'); clearError(); }} />
        </View>
        </>
        )}

        <View style={styles.footer}>
          <Text variant="body" color={theme.colors.textSecondary}>{t('auth.noAccount')} </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/signup' as any)} accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
            <Text variant="body" weight="bold" color={theme.colors.primaryText}>{t('auth.createAccount')}</Text>
          </TouchableOpacity>
        </View>
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
  scroll: { flexGrow: 1, paddingTop: 80 },
  header: { marginBottom: 36 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 28, flexWrap: 'wrap' },
});
