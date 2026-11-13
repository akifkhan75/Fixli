import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Linking } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import * as api from '../../src/services/api';
import { friendlyError } from '../../src/hooks/useApi';
import { FALLBACK_NUMBERS, SOS_ADVICE, SOS_CHOICES, SosChoice, describeContacts, pickAddress, telUrl } from '../../src/utils/sos';

const NUMBERS_KEY = 'sos.numbers.v1';
const COUNTDOWN_S = 10;
const newKey = () => `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

type Step = 'choose' | 'countdown' | 'sending' | 'done';

/**
 * SOS. The emergency numbers are ALWAYS on screen and dial straight from the phone, with or without
 * internet. Life-threatening: show the numbers, alert trusted contacts, never send a worker.
 * Property hazard: 10 s to cancel a false alarm, then an urgent request goes to the nearest professional.
 */
export default function SosScreen() {
  const theme = useTheme();
  const [numbers, setNumbers] = useState<api.EmergencyNumber[]>(FALLBACK_NUMBERS);
  const [disclaimer, setDisclaimer] = useState('Fixli SOS is an emergency coordination tool. It does NOT replace government emergency services. In danger to life, call the emergency numbers directly.');
  const [step, setStep] = useState<Step>('choose');
  const [choice, setChoice] = useState<SosChoice | null>(null);
  const [left, setLeft] = useState(COUNTDOWN_S);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<api.IncidentResult | null>(null);
  const [offline, setOffline] = useState(false);
  const keyRef = useRef(newKey()); // one key per SOS: a retry can never dispatch twice

  // Numbers: last good copy first (works offline), then refresh from the server.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(NUMBERS_KEY).then((raw) => { if (alive && raw) try { setNumbers(JSON.parse(raw)); } catch { /* ignore */ } }).catch(() => undefined);
    api.getEmergencyNumbers().then((r) => {
      if (!alive) return;
      setNumbers(r.numbers); setDisclaimer(r.disclaimer);
      AsyncStorage.setItem(NUMBERS_KEY, JSON.stringify(r.numbers)).catch(() => undefined);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const dial = (n: api.EmergencyNumber) => Linking.openURL(telUrl(n)).catch(() => undefined);

  const send = useCallback(async (c: SosChoice) => {
    setStep('sending'); setError(undefined); setOffline(false);
    try {
      let coords: { latitude?: number; longitude?: number } = {};
      try { // only if permission was already granted; SOS never stops to ask
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const p = (await Location.getLastKnownPositionAsync()) ?? undefined;
          if (p) coords = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        }
      } catch { /* location is a bonus */ }

      if (c === 'LIFE') {
        setResult(await api.reportIncident({ type: 'SOS', severity: 'LIFE_THREATENING', idempotencyKey: keyRef.current, ...coords }));
      } else {
        const addresses = await api.getAddresses();
        const addressId = pickAddress(addresses);
        if (!addressId) { setStep('choose'); setError('Save your address first so we can send someone. If it is dangerous, call the emergency numbers above now.'); return; }
        setResult(await api.reportIncident({ type: 'SOS', severity: 'PROPERTY_DAMAGE', sosKind: c, addressId, idempotencyKey: keyRef.current, ...coords }));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setStep('done');
    } catch (e) {
      const msg = friendlyError(e);
      setOffline(/internet|network|connection/i.test(msg));
      setError(msg);
      setStep('choose');
    }
  }, []);

  // 10-second cancel window for property emergencies.
  useEffect(() => {
    if (step !== 'countdown' || !choice) return;
    if (left <= 0) { void send(choice); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    const t = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [step, left, choice, send]);

  const pick = (c: SosChoice) => {
    setChoice(c); setError(undefined);
    if (c === 'LIFE') { void send(c); } else { setLeft(COUNTDOWN_S); setStep('countdown'); }
  };
  const cancel = () => { setStep('choose'); setChoice(null); setLeft(COUNTDOWN_S); };

  const dialPanel = (
    <View style={{ gap: 10 }} accessibilityRole="summary">
      <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>CALL EMERGENCY SERVICES NOW</Text>
      {numbers.map((n) => (
        <TouchableOpacity key={n.number} onPress={() => dial(n)} accessibilityRole="button" accessibilityLabel={`Call ${n.label} ${n.number}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.error }}>
          <Ionicons name="call" size={26} color="#FFF" />
          <Text variant="h3" weight="extrabold" style={{ color: '#FFF', flex: 1 }}>{n.label}</Text>
          <Text variant="h2" weight="extrabold" style={{ color: '#FFF' }}>{n.number}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
  const note = <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 16 }}>{disclaimer}</Text>;

  if (step === 'done' && result) {
    const contacts = describeContacts(result);
    const hazard = choice && choice !== 'LIFE' ? SOS_ADVICE[choice] : null;
    return (
      <Screen title="Emergency help" back footer={result.jobId ? <Button title="See your request" size="lg" variant="primary" onPress={() => router.replace(`/(customer)/job/${result.jobId}` as any)} /> : <Button title="Done" size="lg" variant="secondary" onPress={() => router.back()} />}>
        {result.jobId ? (
          <>
            <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>We are finding someone near you</Text>
            <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>Your urgent request was sent to the nearest professional. If nobody answers in a few minutes we alert more of them. You will get a notification when a price arrives.</Text>
          </>
        ) : (
          <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>Call for help now</Text>
        )}
        {hazard ? <Text variant="bodyLarge" weight="semibold" color={theme.colors.error} style={{ marginTop: 14 }}>{hazard}</Text> : null}
        <View style={{ marginTop: 18 }}>{dialPanel}</View>
        {contacts ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 16 }}>{contacts}</Text> : null}
        {note}
      </Screen>
    );
  }

  if (step === 'countdown' && choice && choice !== 'LIFE') {
    return (
      <Screen title="Emergency help" scroll={false} footer={<Button title="Cancel: false alarm" size="lg" variant="secondary" onPress={cancel} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityLiveRegion="polite">
          <Text variant="h1" weight="extrabold" color={theme.colors.error} style={{ fontSize: 96, lineHeight: 110 }}>{left}</Text>
          <Text variant="h3" weight="bold" color={theme.colors.textPrimary} style={{ textAlign: 'center' }}>Sending an urgent request…</Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ textAlign: 'center', marginTop: 8 }}>Tap Cancel if this was a mistake.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Emergency help" back>
      {dialPanel}
      {offline ? (
        <Text variant="bodyLarge" weight="bold" color={theme.colors.error} style={{ marginTop: 14 }}>No internet connection. Use the buttons above to call emergency services now.</Text>
      ) : null}
      <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>OR LET FIXLI SEND HELP</Text>
      {SOS_CHOICES.map((c) => (
        <TouchableOpacity key={c.id} disabled={step === 'sending'} onPress={() => pick(c.id)} accessibilityRole="button" accessibilityLabel={`${c.label}. ${c.hint}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 10, borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, opacity: step === 'sending' ? 0.5 : 1 }}>
          <Ionicons name={c.icon as any} size={28} color={c.id === 'LIFE' ? theme.colors.error : theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyLarge" weight="bold" color={theme.colors.textPrimary}>{c.label}</Text>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>{c.hint}</Text>
          </View>
        </TouchableOpacity>
      ))}
      {step === 'sending' ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>Sending…</Text> : null}
      {error ? <Text variant="body" weight="semibold" color={theme.colors.error} style={{ marginTop: 8 }}>{error}</Text> : null}
      {note}
    </Screen>
  );
}
