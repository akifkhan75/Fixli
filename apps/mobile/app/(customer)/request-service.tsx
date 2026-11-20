import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, TouchableOpacity, ScrollView, Linking, Alert } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useI18n } from '../../src/hooks/useI18n';
import { useCountry } from '../../src/hooks/useCountry';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { usePhotoUpload, type Uploaded } from '../../src/hooks/usePhotoUpload';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { TextInput } from '../../src/components/ds/TextInput';
import { ChipChoice } from '../../src/components/ds/ChipChoice';
import { PhotoButtons } from '../../src/components/ds/PhotoButtons';
import { ErrorState, LoadingState } from '../../src/components/ds/EmptyState';
import { VoiceField, type VoiceValue } from '../../src/forms/components/VoiceField';
import { humanize, localizedName } from '../../src/utils/catalog';
import { ApiError } from '../../src/services/api';
import { useNotifications } from '../../src/hooks/useNotifications';
import { useAppSelector } from '../../src/hooks/useRedux';
import { selectCurrentUser } from '../../src/store/authSlice';
import { submitJobRequest } from '../../src/services/outboxHandlers';
import { analytics } from '../../src/services/analytics';
import * as api from '../../src/services/api';
import { t, tn } from '../../src/i18n';
import { DirIcon } from '../../src/components/ds/DirIcon';

type When = 'NOW' | 'TODAY' | 'TOMORROW' | 'SCHEDULED';
type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';
const STEPS = ['What', 'Photos', 'When', 'Where', 'Review'] as const;
const DRAFT_KEY = '@fixli/request-draft';
const MAX_PHOTOS = 4;

interface Draft {
  step: number;
  categoryId?: string;
  issueCodes: string[];
  description: string;
  voice: VoiceValue;
  photos: Uploaded[];
  when: When;
  date?: string;
  slot?: Slot;
  addressId?: string;
  /** Generated once per request: resending after a dropped connection never creates a second job. */
  idempotencyKey: string;
}

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function RequestServiceScreen() {
  const params = useLocalSearchParams<{ categoryId?: string; issue?: string; isEmergency?: string; workerId?: string }>();
  const emergency = params.isEmergency === 'true';
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { config: countryConfig } = useCountry();
  const catalog = useApi(api.getCatalog, [], { cacheKey: 'catalog' });
  const addresses = useApi(api.getAddresses, [], { cacheKey: 'addresses' });
  useFocusEffect(useCallback(() => { addresses.reload(); }, [addresses.reload]));

  const [d, setD] = useState<Draft>(() => ({
    step: 0, categoryId: params.categoryId, issueCodes: params.issue ? [params.issue] : [], description: '',
    voice: { transcript: '' }, photos: [], when: emergency ? 'NOW' : 'TODAY', idempotencyKey: newKey(),
  }));
  const [restored, setRestored] = useState(false);
  const [analysis, setAnalysis] = useState<api.AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const photoUp = usePhotoUpload('JOB_PHOTO');
  const analyzedFor = useRef('');
  const me = useAppSelector(selectCurrentUser);
  const startedAt = useRef(Date.now());
  useEffect(() => { void analytics.track('request_started', { emergency }); }, [emergency]);

  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  // Restore an unfinished request (a dropped call or app switch never loses it) unless this
  // visit came from a different starting point (a tile, SOS).
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(DRAFT_KEY).catch(() => null);
      if (raw && !emergency) {
        try {
          const saved = JSON.parse(raw) as Draft;
          const sameStart = !params.categoryId || saved.categoryId === params.categoryId;
          if (sameStart) setD({ ...saved, step: Math.min(saved.step, 3) });
        } catch { /* ignore broken draft */ }
      }
      setRestored(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (restored && !emergency) AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d)).catch(() => undefined);
  }, [d, restored, emergency]);

  // Pick the default saved address automatically.
  useEffect(() => {
    if (!d.addressId && addresses.data?.length) set({ addressId: (addresses.data.find((a) => a.isDefault) ?? addresses.data[0]).id });
    if (d.addressId && addresses.data && !addresses.data.some((a) => a.id === d.addressId)) set({ addressId: addresses.data[0]?.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.data]);

  const category = catalog.data?.find((c) => c.id === d.categoryId);
  const catName = (c: api.CatalogCategory) => localizedName({ name: c.translations?.en?.name ?? humanize(c.name), translations: c.translations }, locale);
  const issueText = category ? category.issues.filter((i) => d.issueCodes.includes(i.code)).map((i) => localizedName(i, locale)).join(', ') : '';
  const address = addresses.data?.find((a) => a.id === d.addressId);

  const stepValid = [
    !!category && (d.issueCodes.length > 0 || d.description.trim().length >= 3 || !!d.voice.audioUploadId),
    true,
    d.when !== 'SCHEDULED' || (!!d.date && !!d.slot),
    !!address,
    true,
  ];

  // Ask the AI once per distinct input when reaching the review step. It only ever suggests.
  useEffect(() => {
    if (d.step !== 4 || !category) return;
    const signature = JSON.stringify([d.categoryId, d.issueCodes, d.description, d.voice.transcript, d.photos.map((p) => p.id)]);
    if (analyzedFor.current === signature) return;
    analyzedFor.current = signature;
    setAnalyzing(true);
    api.analyzeRequest({
      categoryId: d.categoryId, issueCodes: d.issueCodes,
      description: [d.description, d.voice.transcript].filter(Boolean).join('. ') || undefined,
      photoUploadIds: d.photos.map((p) => p.id),
    }).then(setAnalysis).catch(() => setAnalysis(null)).finally(() => setAnalyzing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.step]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() + i);
    return {
      id: isoLocal(day),
      label: i === 0 ? t('customerRequestService.today') : i === 1 ? t('customerRequestService.tomorrow') : new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(day),
    };
  }), [locale]);

  const addPhoto = async (src: 'camera' | 'library') => {
    const up = await photoUp.run(src);
    if (up) set({ photos: [...d.photos, up].slice(0, MAX_PHOTOS) });
  };

  const { askForPush } = useNotifications();
  const submit = async () => {
    if (!category || !address) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const sent = await submitJobRequest(me?.id ?? '', {
        categoryId: category.id,
        issueCodes: d.issueCodes,
        description: d.description.trim() || undefined,
        photoUploadIds: d.photos.map((p) => p.id),
        audioUploadId: d.voice.audioUploadId,
        audioTranscript: d.voice.audioUploadId ? d.voice.transcript.trim() || undefined : undefined,
        addressId: address.id,
        when: d.when,
        date: d.when === 'SCHEDULED' ? d.date : undefined,
        timeSlot: d.when === 'SCHEDULED' || d.when === 'TOMORROW' ? d.slot : undefined,
        isEmergency: emergency || undefined,
        analysisId: analysis?.analysisId ?? undefined,
        idempotencyKey: d.idempotencyKey,
      }, localizedName(category, locale) ?? category.name, params.workerId);
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
      void analytics.track('request_sent', {
        time_ms: Math.min(3_600_000, Date.now() - startedAt.current),
        used_photo: d.photos.length > 0, used_voice: !!d.voice.audioUploadId, emergency,
      });
      if (sent.queued) {
        // No signal: saved on the phone and sent when back online (the bar at the top says so).
        Alert.alert(t('offline.requestSaved'));
        router.replace('/(customer)/bookings' as any);
        return;
      }
      const job = sent.result;
      // Right after sending is when "we'll tell you when prices arrive" makes sense.
      void askForPush();
      // "Book again": ask the same professional first. If they're not available, the request
      // simply stays open for others (matching already ran).
      if (params.workerId) await api.requestWorkerForJob(job.id, params.workerId).catch(() => undefined);
      router.replace(`/(customer)/job/${job.id}` as any);
    } catch (e) {
      setError(e instanceof ApiError
        ? (e.code === 'OFFLINE' ? t('offline.emergency') : e.userMessage)
        : friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const back = () => (d.step === 0 ? router.back() : set({ step: d.step - 1 }));
  const next = () => { void analytics.track('request_step_completed', { step: STEPS[d.step].toLowerCase() }); set({ step: Math.min(4, d.step + 1) }); };

  if (catalog.loading && !catalog.data) return <Screen title={t('customerRequestService.getHelp')} back><LoadingState /></Screen>;
  if (catalog.error && !catalog.data) return <Screen title={t('customerRequestService.getHelp')} back><ErrorState message={catalog.error} onRetry={catalog.reload} /></Screen>;

  const emergencyCard = (strong: boolean) => (
    <View style={{ backgroundColor: theme.colors.sos + (strong ? '22' : '12'), borderColor: theme.colors.sos, borderWidth: strong ? 1.5 : 0, borderRadius: 16, padding: 16, marginBottom: 20 }} accessibilityRole="alert">
      <Text variant="bodyLarge" weight="bold" color={theme.colors.errorText}>{t('customerRequestService.ifAnyoneIsIn')}</Text>
      <Text variant="bodySmall" color={theme.colors.textPrimary} style={{ marginTop: 4, marginBottom: 12 }}>
        {t('customerRequestService.fixliConnectsYouWith')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {countryConfig.emergencyNumbers.map((n) => (
          <TouchableOpacity key={n.number} onPress={() => Linking.openURL(`tel:${n.number}`)} accessibilityRole="button" accessibilityLabel={t('customerRequestService.call', { label: n.label, number: n.number })}
            style={{ backgroundColor: theme.colors.sos, borderRadius: 12, paddingHorizontal: 16, minHeight: 48, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="call" size={18} color="#FFF" />
            <Text variant="body" weight="bold" color="#FFF" style={{ marginStart: 8 }}>{n.label} {n.number}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const footer = d.step < 4
    ? <Button title={d.step === 1 && d.photos.length === 0 ? t('customerRequestService.skipForNow') : t('customerRequestService.continue')} variant="primary" size="lg" disabled={!stepValid[d.step]} onPress={next} />
    : <Button title={t('customerRequestService.sendRequest')} variant="primary" size="lg" loading={submitting} disabled={submitting || !stepValid.every(Boolean)} onPress={submit} />;

  return (
    <Screen footer={footer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={back} accessibilityRole="button" accessibilityLabel={t('authSignup.back')} style={{ width: 44, height: 44, justifyContent: 'center' }}>
          <DirIcon name="arrow-back" size={26} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text variant="bodySmall" weight="semibold" color={emergency ? theme.colors.errorText : theme.colors.textSecondary} style={{ flex: 1 }}>
          {emergency ? t('customerRequestService.urgentHelp') : t('customerRequestService.stepOf', { step: d.step + 1, total: STEPS.length })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 24 }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 5, now: d.step + 1 }}>
        {STEPS.map((s, i) => <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= d.step ? (emergency ? theme.colors.sos : theme.colors.primary) : theme.colors.border }} />)}
      </View>

      {emergency && d.step < 4 ? emergencyCard(false) : null}

      {d.step === 0 ? (
        <View>
          <Text variant="h1" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 16 }}>{t('customerHome.whatNeedsFixing')}</Text>
          {!params.categoryId || !category ? (
            <>
              <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginBottom: 8 }}>{t('customerRequestService.typeOfHelp')}</Text>
              <ChipChoice options={(catalog.data ?? []).map((c) => ({ id: c.id, label: catName(c) }))} selectedIds={d.categoryId ? [d.categoryId] : []}
                onChange={(ids) => set({ categoryId: ids[0], issueCodes: [] })} />
            </>
          ) : (
            <Text variant="bodyLarge" weight="semibold" color={theme.colors.primaryText} style={{ marginBottom: 4 }}>{catName(category)}</Text>
          )}
          {category ? (
            <>
              <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 20, marginBottom: 8 }}>{t('customerRequestService.whatIsTheProblem')}</Text>
              <ChipChoice multiSelect options={category.issues.map((i) => ({ id: i.code, label: localizedName(i, locale) }))} selectedIds={d.issueCodes} onChange={(ids) => set({ issueCodes: ids })} />
              <View style={{ marginTop: 24 }}>
                <VoiceField value={d.voice} onChange={(voice) => set({ voice })} locale={locale} />
              </View>
              <View style={{ marginTop: 20 }}>
                <TextInput label={t('customerRequestService.orWriteAFew')} placeholder={t('customerRequestService.eGWaterDrips')} value={d.description} onChangeText={(v) => set({ description: v })} multiline maxLength={2000} style={{ minHeight: 70, textAlignVertical: 'top' }} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {d.step === 1 ? (
        <View>
          <Text variant="h1" weight="bold" color={theme.colors.textPrimary}>{t('customerRequestService.showUs')}</Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 6, marginBottom: 20 }}>{t('customerRequestService.aPhotoHelpsThe')}</Text>
          {d.photos.length ? (
            <ScrollView horizontal style={{ marginBottom: 16 }} showsHorizontalScrollIndicator={false}>
              {d.photos.map((p) => (
                <View key={p.id} style={{ marginEnd: 10 }}>
                  <Image source={{ uri: p.localUri }} style={{ width: 120, height: 120, borderRadius: 14, backgroundColor: theme.colors.surface }} accessibilityLabel={t('customerRequestService.photoOfTheProblem')} />
                  <TouchableOpacity onPress={() => set({ photos: d.photos.filter((x) => x.id !== p.id) })} accessibilityRole="button" accessibilityLabel={t('customerRequestService.removePhoto')}
                    style={{ position: 'absolute', top: 4, end: 4, backgroundColor: '#000A', borderRadius: 14, padding: 2 }}>
                    <Ionicons name="close" size={20} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : null}
          {d.photos.length < MAX_PHOTOS ? <PhotoButtons onPick={addPhoto} busy={photoUp.busy} error={photoUp.error} denied={photoUp.denied} /> : <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('requestService.maxPhotos', { n: MAX_PHOTOS })}</Text>}
        </View>
      ) : null}

      {d.step === 2 ? (
        <View>
          <Text variant="h1" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 20 }}>{t('customerRequestService.whenDoYouNeed')}</Text>
          <ChipChoice options={[{ id: 'NOW', label: t('customerRequestService.now') }, { id: 'TODAY', label: t('customerRequestService.today') }, { id: 'TOMORROW', label: t('customerRequestService.tomorrow') }, { id: 'SCHEDULED', label: t('customerRequestService.chooseADay') }]}
            selectedIds={[d.when]} onChange={(ids) => ids[0] && set({ when: ids[0] as When, ...(ids[0] === 'SCHEDULED' ? {} : { date: undefined }) })} />
          {d.when === 'SCHEDULED' ? (
            <>
              <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>{t('customerRequestService.day')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <ChipChoice options={days} selectedIds={d.date ? [d.date] : []} onChange={(ids) => set({ date: ids[0] })} />
              </ScrollView>
            </>
          ) : null}
          {d.when === 'SCHEDULED' || d.when === 'TOMORROW' ? (
            <>
              <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>{d.when === 'TOMORROW' ? t('requestService.timeOfDayOptional') : t('requestService.timeOfDay')}</Text>
              <ChipChoice options={[{ id: 'MORNING', label: t('customerRequestService.morning812') }, { id: 'AFTERNOON', label: t('customerRequestService.afternoon125') }, { id: 'EVENING', label: t('customerRequestService.evening59') }]}
                selectedIds={d.slot ? [d.slot] : []} onChange={(ids) => set({ slot: ids[0] as Slot | undefined })} />
            </>
          ) : null}
        </View>
      ) : null}

      {d.step === 3 ? (
        <View>
          <Text variant="h1" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 8 }}>{t('customerRequestService.where')}</Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 20 }}>{t('customerRequestService.professionalsOnlySeeYour')}</Text>
          {addresses.loading && !addresses.data ? <LoadingState /> : (addresses.data ?? []).map((a) => {
            const selected = a.id === d.addressId;
            return (
              <TouchableOpacity key={a.id} onPress={() => set({ addressId: a.id })} accessibilityRole="radio" accessibilityState={{ selected }}
                style={{ borderWidth: 1.5, borderColor: selected ? theme.colors.primary : theme.colors.border, backgroundColor: selected ? theme.colors.primary + '10' : theme.colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={24} color={selected ? theme.colors.primary : theme.colors.textTertiary} />
                <View style={{ flex: 1, marginStart: 12 }}>
                  <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary}>{a.label ?? t('customerRequestService.address')}</Text>
                  <Text variant="bodySmall" color={theme.colors.textSecondary}>{[a.buildingDetail, a.streetAddress, a.area, a.city].filter(Boolean).join(', ')}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <Button title={addresses.data?.length ? t('customerRequestService.addAnotherAddress') : t('customerRequestService.addYourAddress')} variant={addresses.data?.length ? 'secondary' : 'primary'} size="lg"
            onPress={() => router.push('/address-edit' as any)} leftIcon={<Ionicons name="add" size={22} color={addresses.data?.length ? theme.colors.primary : '#FFF'} />} />
        </View>
      ) : null}

      {d.step === 4 && category ? (
        <View>
          <Text variant="h1" weight="bold" color={theme.colors.textPrimary} style={{ marginBottom: 20 }}>{t('customerRequestService.checkAndSend')}</Text>
          {analysis?.safety.lifeThreatening ? emergencyCard(true) : null}

          {analyzing ? <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginBottom: 12 }}>{t('customerRequestService.lookingAtYourRequest')}</Text> : null}
          {analysis?.suggestion && analysis.suggestion.categoryId !== d.categoryId && analysis.suggestion.confidence >= 0.6 ? (() => {
            const s = catalog.data?.find((c) => c.id === analysis.suggestion!.categoryId);
            return s ? (
              <View style={{ backgroundColor: theme.colors.primary + '12', borderRadius: 16, padding: 14, marginBottom: 16 }}>
                <Text variant="body" color={theme.colors.textPrimary}>{t('requestService.soundsLike')} <Text variant="body" weight="bold" color={theme.colors.textPrimary}>{catName(s)}</Text>.</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <Button title={t('customerRequestService.switchTo', { name: catName(s) })} size="sm" variant="primary" onPress={() => set({ categoryId: s.id, issueCodes: analysis.suggestion!.issueCodes })} />
                  <Button title={t('customerRequestService.keepMine')} size="sm" variant="ghost" onPress={() => setAnalysis({ ...analysis, suggestion: null })} />
                </View>
              </View>
            ) : null;
          })() : null}

          {[
            { step: 0, icon: 'construct' as const, title: catName(category), body: [issueText, d.description.trim(), d.voice.transcript.trim()].filter(Boolean).join(' · ') || (d.voice.audioUploadId ? t('customerRequestService.voiceAttached') : '') },
            { step: 1, icon: 'camera' as const, title: d.photos.length ? tn('customerRequestService.photos', d.photos.length) : t('customerRequestService.noPhotos'), body: d.voice.audioUploadId ? t('customerRequestService.voiceAttached') : '' },
            { step: 2, icon: 'calendar' as const, title: d.when === 'NOW' ? t('customerRequestService.now') : d.when === 'TODAY' ? t('customerRequestService.today') : d.when === 'TOMORROW' ? t('customerRequestService.tomorrow') : days.find((x) => x.id === d.date)?.label ?? '', body: d.slot ? { MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening' }[d.slot] : '' },
            { step: 3, icon: 'location' as const, title: address?.label ?? t('customerRequestService.address'), body: address ? [address.streetAddress, address.area, address.city].filter(Boolean).join(', ') : '' },
          ].map((row) => (
            <TouchableOpacity key={row.step} onPress={() => set({ step: row.step })} accessibilityRole="button" accessibilityLabel={t('customerRequestService.change', { title: row.title, body: row.body })}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, marginBottom: 10 }}>
              <Ionicons name={row.icon} size={22} color={theme.colors.primary} />
              <View style={{ flex: 1, marginHorizontal: 12 }}>
                <Text variant="body" weight="semibold" color={theme.colors.textPrimary}>{row.title}</Text>
                {row.body ? <Text variant="bodySmall" color={theme.colors.textSecondary} numberOfLines={3}>{row.body}</Text> : null}
              </View>
              <Text variant="bodySmall" weight="semibold" color={theme.colors.primaryText}>{t('customerRequestService.change2')}</Text>
            </TouchableOpacity>
          ))}

          <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'flex-start' }}>
            <Ionicons name="pricetag-outline" size={20} color={theme.colors.textSecondary} />
            <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ flex: 1, marginStart: 8 }}>
              {t('customerRequestService.youWillSeeEach')}
            </Text>
          </View>
          {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
        </View>
      ) : null}
    </Screen>
  );
}
