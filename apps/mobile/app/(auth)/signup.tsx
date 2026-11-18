import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkPassword, passwordIssueMessage } from '@fixli/shared';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useCountry } from '../../src/hooks/useCountry';
import { usePhoneInput } from '../../src/forms/usePhoneInput';
import { Text } from '../../src/components/ds/Text';
import { TextInput } from '../../src/components/ds/TextInput';
import { Button } from '../../src/components/ds/Button';
import { PhoneField } from '../../src/components/ds/PhoneField';
import { PasswordField } from '../../src/components/ds/PasswordField';
import { CountryPicker } from '../../src/components/ds/CountryPicker';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import * as api from '../../src/services/api';
import { OtpCodeStep } from '../../src/components/ds/OtpCodeStep';
import { signupUser, selectAuthError, selectIsAuthLoading, clearAuthError } from '../../src/store/authSlice';
import { DirIcon } from '../../src/components/ds/DirIcon';

type Role = 'customer' | 'worker';

// Survives the app being killed while the user fetches the SMS. The password is never stored.
const DRAFT_KEY = '@signup_draft_v1';

export default function SignupScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const dispatch = useAppDispatch();
  const error = useAppSelector(selectAuthError);
  const loading = useAppSelector(selectIsAuthLoading);
  const { country, config, countries, setCountry } = useCountry();
  const phone = usePhoneInput(country, setCountry, countries.map((c) => c.code));

  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(60);
  const draftLoaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d.role === 'customer' || d.role === 'worker') setRole(d.role);
          if (typeof d.name === 'string') setName(d.name);
          if (typeof d.phone === 'string' && d.phone) phone.onChangeText(d.phone);
        }
      } catch { /* a missing draft is fine */ }
      draftLoaded.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftLoaded.current) return;
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ role, name, phone: phone.text })).catch(() => {});
  }, [role, name, phone.text]);

  const passwordIssue = useMemo(
    () => (password ? checkPassword(password, phone.result.e164)[0] : undefined),
    [password, phone.result.e164],
  );
  const nameError = submitted && name.trim().length < 2 ? t('auth.nameError') : undefined;
  const passwordError = (submitted || password.length >= 8) && passwordIssue ? passwordIssueMessage(passwordIssue) : undefined;

  const clearError = () => { if (error) dispatch(clearAuthError()); };

  const sendCode = async () => {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const r = await api.startPhoneVerification(phone.result.e164!, country);
      setResendSeconds(r.resendInSeconds);
      setStep('code');
    } catch (e: any) {
      if (e instanceof api.ApiError && e.code === 'OTP_COOLDOWN') {
        // A code was already sent a moment ago (e.g. the app restarted): go on and enter it.
        setResendSeconds(Number((e.details as any)?.retryAfterSeconds) || 60);
        setStep('code');
      } else {
        setOtpError(e instanceof api.ApiError ? e.message : t('auth.networkError'));
      }
    } finally {
      setOtpBusy(false);
    }
  };

  const onSubmit = () => {
    setSubmitted(true);
    phone.touch();
    if (!role || name.trim().length < 2 || !phone.isValid || !password || checkPassword(password, phone.result.e164).length) return;
    sendCode();
  };

  const onVerify = async (code: string) => {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const { signupToken } = await api.verifyPhoneCode(phone.result.e164!, country, code);
      await dispatch(signupUser({ name: name.trim(), phone: phone.result.e164!, countryCode: country, password, type: role!, locale, signupToken })).unwrap();
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
    } catch (e: any) {
      // A failed signup (e.g. number already registered) has used up the token: back to the form, where the error shows.
      if (e instanceof api.ApiError) setOtpError(e.message);
      else if (typeof e === 'string') setStep('details');
      else setOtpError(t('auth.networkError'));
    } finally {
      setOtpBusy(false);
    }
  };

  const back = () => (step === 'code' ? setStep('details') : role ? setRole(null) : router.back());

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: theme.spacing['2xl'] }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.back} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <DirIcon name="arrow-back" size={28} color={theme.colors.textPrimary} />
        </TouchableOpacity>

        {!role ? (
          <View>
            <Text variant="h1" weight="extrabold" color={theme.colors.textPrimary} style={{ marginBottom: 28 }}>{t('auth.signupTitle')}</Text>
            {([
              { id: 'customer', icon: 'home-outline', title: t('auth.roleCustomer'), sub: t('auth.roleCustomerSub') },
              { id: 'worker', icon: 'construct-outline', title: t('auth.roleWorker'), sub: t('auth.roleWorkerSub') },
            ] as const).map((r) => (
              <TouchableOpacity
                key={r.id}
                onPress={() => { dispatch(clearAuthError()); setRole(r.id); }}
                accessibilityRole="button"
                accessibilityLabel={`${r.title}. ${r.sub}`}
                style={[styles.roleCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.borderRadius.xl }]}
                activeOpacity={0.8}
              >
                <View style={[styles.roleIcon, { backgroundColor: theme.colors.primary + '15' }]}>
                  <Ionicons name={r.icon} size={30} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1, marginHorizontal: 16 }}>
                  <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{r.title}</Text>
                  <Text variant="bodySmall" color={theme.colors.textSecondary}>{r.sub}</Text>
                </View>
                <DirIcon name="chevron-forward" size={22} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            ))}
            <View style={styles.footer}>
              <Text variant="body" color={theme.colors.textSecondary}>{t('auth.haveAccount')} </Text>
              <TouchableOpacity onPress={() => router.replace('/(auth)/login' as any)} accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
                <Text variant="body" weight="bold" color={theme.colors.primary}>{t('auth.signIn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : step === 'code' ? (
          <View>
            <Text variant="h1" weight="extrabold" color={theme.colors.textPrimary} style={{ marginBottom: 8 }}>{t('auth.otpTitle')}</Text>
            <OtpCodeStep
              phoneLabel={phone.text}
              resendSeconds={resendSeconds}
              loading={otpBusy || loading}
              error={otpError}
              submitLabel={t('auth.otpVerify')}
              onSubmit={onVerify}
              onResend={sendCode}
              onChangeNumber={() => setStep('details')}
              onChangeCode={() => setOtpError(null)}
            />
          </View>
        ) : (
          <View>
            <Text variant="h1" weight="extrabold" color={theme.colors.textPrimary} style={{ marginBottom: 8 }}>{t('auth.yourDetails')}</Text>
            {role === 'worker' ? (
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginBottom: 20 }}>{t('auth.workerNote')}</Text>
            ) : <View style={{ height: 12 }} />}

            <TextInput
              label={t('auth.fullName')}
              value={name}
              onChangeText={(v) => { clearError(); setName(v); }}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              error={nameError}
            />
            <View style={{ height: 16 }} />
            <PhoneField
              label={t('auth.phone')}
              country={config}
              value={phone.text}
              onChangeText={(v) => { clearError(); phone.onChangeText(v); }}
              onBlur={phone.onBlur}
              onCountryPress={() => setPickerOpen(true)}
              canChangeCountry={countries.length > 1}
              error={phone.error}
            />
            <View style={{ height: 16 }} />
            <PasswordField
              isNew
              label={t('auth.createPassword')}
              value={password}
              onChangeText={(v) => { clearError(); setPassword(v); }}
              error={passwordError}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            {!passwordError ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 6 }}>{t('auth.passwordHint')}</Text> : null}

            {error || otpError ? (
              <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 16 }}>{error || otpError}</Text>
            ) : null}

            <View style={{ marginTop: 28 }}>
              <Button title={t('auth.continue')} variant="primary" size="lg" loading={loading || otpBusy} disabled={loading || otpBusy} onPress={onSubmit} />
            </View>
          </View>
        )}
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
  roleCard: { flexDirection: 'row', alignItems: 'center', padding: 18, borderWidth: 1.5, marginBottom: 16 },
  roleIcon: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, flexWrap: 'wrap' },
});
