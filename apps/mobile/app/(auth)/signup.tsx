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
import { TextInput } from '../../src/components/ds/TextInput';
import { Button } from '../../src/components/ds/Button';
import { PhoneField } from '../../src/components/ds/PhoneField';
import { PasswordField } from '../../src/components/ds/PasswordField';
import { CountryPicker } from '../../src/components/ds/CountryPicker';
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { signupUser, selectAuthError, selectIsAuthLoading, clearAuthError } from '../../src/store/authSlice';
import { t } from '../../src/i18n';
import { DirIcon } from '../../src/components/ds/DirIcon';

type Role = 'customer' | 'worker';

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

  const passwordIssue = useMemo(
    () => (password ? checkPassword(password, phone.result.e164)[0] : undefined),
    [password, phone.result.e164],
  );
  const nameError = submitted && name.trim().length < 2 ? t('auth.nameError') : undefined;
  const passwordError = (submitted || password.length >= 8) && passwordIssue ? passwordIssueMessage(passwordIssue) : undefined;

  const clearError = () => { if (error) dispatch(clearAuthError()); };

  const onSubmit = () => {
    setSubmitted(true);
    phone.touch();
    if (!role || name.trim().length < 2 || !phone.isValid || !password || checkPassword(password, phone.result.e164).length) return;
    dispatch(signupUser({
      name: name.trim(),
      phone: phone.result.e164!,
      countryCode: country,
      password,
      type: role,
      locale,
    }));
  };

  const back = () => (role ? setRole(null) : router.back());

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: theme.spacing['2xl'] }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel={t('authSignup.back')} style={styles.back} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
                <Text variant="body" weight="bold" color={theme.colors.primaryText}>{t('auth.signIn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <Text variant="h1" weight="extrabold" color={theme.colors.textPrimary} style={{ marginBottom: 8 }}>{t('auth.yourDetails')}</Text>
            {role === 'worker' ? (
              <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginBottom: 20 }}>{t('auth.workerNote')}</Text>
            ) : <View style={{ height: 12 }} />}

            <TextInput
              testID="name-input"
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
              label={t('auth.createPassword')}
              value={password}
              onChangeText={(v) => { clearError(); setPassword(v); }}
              error={passwordError}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            {!passwordError ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 6 }}>{t('auth.passwordHint')}</Text> : null}

            {error ? (
              <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text>
            ) : null}

            <View style={{ marginTop: 28 }}>
              <Button title={t('auth.signUp')} variant="primary" size="lg" loading={loading} disabled={loading} onPress={onSubmit} />
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
