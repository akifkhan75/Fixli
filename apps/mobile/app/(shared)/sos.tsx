import { analytics } from '../../src/services/analytics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { routes } from '@fixli/shared';
import { useTheme } from '../../src/hooks/useTheme';
import { friendlyError } from '../../src/hooks/useApi';
import { useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser } from '../../src/store/authSlice';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { SOS_COPY as C } from '../../src/safety/copy';
import { loadEmergencyNumbers, type EmergencyNumber } from '../../src/services/emergencyNumbers';
import { newClientId } from '../../src/services/chatOutbox';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';

type Step = 'countdown' | 'choose' | 'life' | 'steps' | 'inJob';
type Property = 'WATER' | 'ELECTRIC' | 'GAS';
const COUNTDOWN = 5;

/**
 * SOS (doc 22 §5.1, doc 27 F5). Works with no payment method. Life-threatening never sends a
 * professional; it shows the country's emergency numbers (cached for offline use) and tells the
 * safety team and trusted contacts. Water/electric/gas: safety steps, then the nearest free pro.
 */
export default function SosScreen() {
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const theme = useTheme();
  const me = useAppSelector(selectCurrentUser);
  const [step, setStep] = useState<Step>(jobId ? 'inJob' : 'countdown');
  const [left, setLeft] = useState(COUNTDOWN);
  const [kind, setKind] = useState<Property | null>(null);
  const [numbers, setNumbers] = useState<EmergencyNumber[]>([]);
  const [result, setResult] = useState<api.SosResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const key = useRef(newClientId()).current; // one emergency per visit, even if sent twice

  useEffect(() => { void loadEmergencyNumbers((me as any)?.countryCode).then(setNumbers); }, [me]);

  useEffect(() => {
    if (step !== 'countdown') return undefined;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    if (left === 0) { setStep('choose'); return undefined; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, left]);

  const send = async (k: api.SosKind) => {
    setBusy(true);
    setError(undefined);
    try {
      if (k !== 'IN_JOB') void analytics.track('emergency_opened', { kind: k.toLowerCase() as 'life_threatening' | 'water' | 'electric' | 'gas' });
      const r = await api.raiseSos({ kind: k, idempotencyKey: key, ...(k === 'IN_JOB' ? { jobRequestId: jobId } : {}) });
      setResult(r);
      if (r.emergencyNumbers?.length) setNumbers(r.emergencyNumbers);
      if (r.jobRequestId) router.replace(routes.customerJob(r.jobRequestId) as any);
    } catch (e) {
      setError(friendlyError(e));
    } finally { setBusy(false); }
  };

  const callButtons = useMemo(() => (
    <View style={{ gap: 10, marginTop: 16 }}>
      {numbers.map((n) => (
        <TouchableOpacity key={n.number} onPress={() => { void analytics.track('emergency_call_initiated'); void Linking.openURL(`tel:${n.number}`); }} accessibilityRole="button" accessibilityLabel={`${C.callNow}: ${n.label} ${n.number}`}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.error, borderRadius: theme.borderRadius.xl, padding: 18, gap: 14 }}>
          <Ionicons name="call" size={26} color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <Text variant="h3" weight="bold" color="#FFFFFF">{n.label}</Text>
            <Text variant="bodyLarge" color="#FFFFFF">{n.number}</Text>
          </View>
          <Text variant="body" weight="semibold" color="#FFFFFF">{C.callNow}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ), [numbers, theme]);

  if (step === 'countdown') {
    return (
      <Screen title={C.holdTitle} back>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
          <View style={{ width: 160, height: 160, borderRadius: 80, backgroundColor: theme.colors.error, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="h1" weight="extrabold" color="#FFFFFF" accessibilityLiveRegion="assertive">{left}</Text>
          </View>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ marginTop: 24 }}>{C.countdown(left)}</Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>{C.countdownHint}</Text>
          <View style={{ width: '100%', marginTop: 32 }}><Button title={C.cancel} variant="secondary" size="lg" onPress={() => { void analytics.track('safety_cancel'); router.back(); }} /></View>
        </View>
      </Screen>
    );
  }

  if (step === 'choose') {
    return (
      <Screen title={C.chooseTitle} back>
        {(['LIFE_THREATENING', 'WATER', 'ELECTRIC', 'GAS'] as const).map((k) => (
          <TouchableOpacity key={k} accessibilityRole="button" accessibilityLabel={C.kinds[k].label}
            onPress={() => { if (k === 'LIFE_THREATENING') { setStep('life'); void send('LIFE_THREATENING'); } else { setKind(k); setStep('steps'); } }}
            style={{ backgroundColor: k === 'LIFE_THREATENING' ? theme.colors.error : theme.colors.surface, borderRadius: theme.borderRadius.xl, padding: 18, marginBottom: 12 }}>
            <Text variant="h3" weight="bold" color={k === 'LIFE_THREATENING' ? '#FFFFFF' : theme.colors.textPrimary}>{C.kinds[k].label}</Text>
            <Text variant="body" color={k === 'LIFE_THREATENING' ? '#FFFFFF' : theme.colors.textSecondary}>{C.kinds[k].sub}</Text>
          </TouchableOpacity>
        ))}
        {callButtons}
      </Screen>
    );
  }

  if (step === 'life' || step === 'inJob') {
    const sent = !!result;
    return (
      <Screen title={step === 'life' ? C.lifeTitle : C.inJobTitle} back>
        <Text variant="body" color={theme.colors.textPrimary}>{step === 'life' ? C.lifeBody : C.inJobBody}</Text>
        {callButtons}
        {step === 'life' ? <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 12 }}>{C.noWorker}</Text> : null}
        {step === 'inJob' && !sent ? <View style={{ marginTop: 20 }}><Button title={C.inJobSend} variant="danger" size="lg" loading={busy} disabled={busy} onPress={() => void send('IN_JOB')} /></View> : null}
        {step === 'inJob' && sent ? <Text variant="body" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 16 }}>{C.inJobSent}</Text> : null}
        {result?.contacts ? (
          <Text variant="body" color={result.contacts.status === 'SENT' ? theme.colors.textPrimary : theme.colors.warningText} style={{ marginTop: 12 }} accessibilityRole="alert">{result.contacts.message}</Text>
        ) : null}
        {error ? <Text variant="body" color={theme.colors.errorText} style={{ marginTop: 12 }} accessibilityRole="alert">{`${error} ${C.offline}`}</Text> : null}
        {step === 'life' && error ? <View style={{ marginTop: 12 }}><Button title={t('sharedSos.tryAgain')} variant="secondary" onPress={() => void send('LIFE_THREATENING')} /></View> : null}
        <View style={{ marginTop: 16 }}><Button title={t('sharedSos.trustedContacts')} variant="ghost" onPress={() => router.push('/trusted-contacts' as any)} /></View>
      </Screen>
    );
  }

  // Property emergency: safety first, then find someone.
  const k = kind!;
  return (
    <Screen title={C.kinds[k].label} back footer={<Button title={busy ? C.sendingRequest : C.sendRequest} variant="danger" size="lg" loading={busy} disabled={busy} onPress={() => void send(k)} />}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{t('sharedSos.doThisFirst')}</Text>
      <View style={{ gap: 10, marginTop: 10 }}>
        {C.steps[k].map((s, i) => (
          <View key={s} style={{ flexDirection: 'row', gap: 10 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.errorText}>{i + 1}.</Text>
            <Text variant="bodyLarge" color={theme.colors.textPrimary} style={{ flex: 1 }}>{s}</Text>
          </View>
        ))}
      </View>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 16 }}>{t('sharedSos.ifAnyoneIsHurt')}</Text>
      {callButtons}
      {error ? <Text variant="body" color={theme.colors.errorText} style={{ marginTop: 12 }} accessibilityRole="alert">{error}</Text> : null}
      {error && /address/i.test(error) ? <View style={{ marginTop: 8 }}><Button title={t('sharedSos.addAddress')} variant="secondary" onPress={() => router.push('/address-edit' as any)} /></View> : null}
    </Screen>
  );
}
