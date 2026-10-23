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
import { useAppDispatch, useAppSelector } from '../../src/hooks/useRedux';
import { loginUser, selectAuthError, selectIsAuthLoading, clearAuthError } from '../../src/store/authSlice';

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

  const clearError = () => { if (error) dispatch(clearAuthError()); };

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
          <Text variant="bodyLarge" color={theme.colors.textSecondary}>{t('auth.signinSub')}</Text>
        </View>

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
        <View style={{ height: 16 }} />
        <PasswordField
          label={t('auth.password')}
          value={password}
          onChangeText={(v) => { clearError(); setPassword(v); }}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

        {error ? (
          <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: 28 }}>
          <Button title={t('auth.signIn')} variant="primary" size="lg" loading={loading} disabled={loading} onPress={onSubmit} />
        </View>

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
