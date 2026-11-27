import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { routes } from '@fixli/shared';
import { useTheme } from '../../../../src/hooks/useTheme';
import { useI18n } from '../../../../src/hooks/useI18n';
import { useCountry } from '../../../../src/hooks/useCountry';
import { useApi, friendlyError } from '../../../../src/hooks/useApi';
import { useAppSelector } from '../../../../src/hooks/useRedux';
import { selectCurrentUser } from '../../../../src/store/authSlice';
import { usePhotoUpload, type Uploaded } from '../../../../src/hooks/usePhotoUpload';
import { useNotifications } from '../../../../src/hooks/useNotifications';
import { submitProject } from '../../../../src/services/outboxHandlers';
import * as api from '../../../../src/services/api';
import { catalogName } from '../../../../src/utils/catalog';
import { currencyExponent, formatMoney, parseMajorToMinor } from '../../../../src/utils/money';
import { PROPERTY_TYPES, START_WHEN, WORK_TYPES, workTypeLabel } from '../../../../src/utils/projectStatus';
import { Screen } from '../../../../src/components/ds/Screen';
import { Text } from '../../../../src/components/ds/Text';
import { TextInput } from '../../../../src/components/ds/TextInput';
import { Button } from '../../../../src/components/ds/Button';
import { Card } from '../../../../src/components/ds/Card';
import { ChipChoice } from '../../../../src/components/ds/ChipChoice';
import { ChoiceCard } from '../../../../src/components/ds/ChoiceCard';
import { CategoryTile } from '../../../../src/components/ds/CategoryTile';
import { AmountField } from '../../../../src/components/ds/AmountField';
import { PhotoButtons } from '../../../../src/components/ds/PhotoButtons';
import { PhotoStrip } from '../../../../src/components/ds/PhotoStrip';
import { SpeakButton } from '../../../../src/components/ds/SpeakButton';
import { DirIcon } from '../../../../src/components/ds/DirIcon';
import { ErrorState, LoadingState } from '../../../../src/components/ds/EmptyState';
import { Entrance } from '../../../../src/components/motion/Entrance';
import { ProgressBar } from '../../../../src/components/motion/ProgressBar';
import { PressableScale } from '../../../../src/components/motion/PressableScale';
import { VoiceField, type VoiceValue } from '../../../../src/forms/components/VoiceField';

const STEPS = 5;
const DRAFT_KEY = '@fixli/project-draft';
const MAX_PHOTOS = 8;
/** Building trades come first here; the rest keep the catalog's order. */
const PROJECT_FIRST = ['CONSTRUCTION', 'RENOVATION', 'ELECTRICAL', 'PLUMBING', 'MASONRY', 'FLOORING', 'PAINTING', 'CARPENTRY', 'SOLAR'];
const projectRank = (name: string) => { const i = PROJECT_FIRST.indexOf(name); return i === -1 ? PROJECT_FIRST.length : i; };
/** Matches the server: money is stored as 32-bit minor units. */
const MAX_MINOR = 2_000_000_000;

interface Draft {
  step: number;
  categoryId?: string;
  workType?: api.WorkType;
  propertyType: api.PropertyType;
  description: string;
  voice: VoiceValue;
  photos: Uploaded[];
  budget: string;
  startWhen: api.StartWhen;
  addressId?: string;
  /** Empty until the person types one; a suggestion or default is shown meanwhile. */
  title: string;
  idempotencyKey: string;
}

const fresh = (): Draft => ({
  step: 0, propertyType: 'HOUSE', description: '', voice: { transcript: '' }, photos: [], budget: '', startWhen: 'ASAP', title: '',
  idempotencyKey: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
});

/** "Get work done": five short picture-first steps for building, renovating and installing. */
export default function NewProjectScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { config } = useCountry();
  const { width } = useWindowDimensions();
  const me = useAppSelector(selectCurrentUser);
  const catalog = useApi(api.getCatalog, [], { cacheKey: 'catalog' });
  const addresses = useApi(api.getAddresses, [], { cacheKey: 'addresses' });
  useFocusEffect(useCallback(() => { addresses.reload(); }, [addresses.reload]));
  const photoUp = usePhotoUpload('JOB_PHOTO');
  const { askForPush } = useNotifications();

  const [d, setD] = useState<Draft>(fresh);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const [restored, setRestored] = useState(false);
  const [scope, setScope] = useState<api.ProjectScope | null>(null);
  const [thinking, setThinking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const askedFor = useRef('');

  // An interrupted post (a call, a dead battery) is picked up where it stopped.
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => { if (raw) setD({ ...fresh(), ...(JSON.parse(raw) as Draft) }); })
      .catch(() => undefined)
      .finally(() => setRestored(true));
  }, []);
  useEffect(() => { if (restored) AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d)).catch(() => undefined); }, [d, restored]);

  useEffect(() => {
    if (!addresses.data?.length) return;
    if (!d.addressId || !addresses.data.some((a) => a.id === d.addressId)) set({ addressId: (addresses.data.find((a) => a.isDefault) ?? addresses.data[0]).id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.data, d.addressId]);

  const currency = config.currency.code;
  const category = catalog.data?.find((c) => c.id === d.categoryId);
  const address = addresses.data?.find((a) => a.id === d.addressId);
  const described = d.description.trim().length >= 3 || !!d.voice.audioUploadId || d.photos.length > 0;
  const budgetMinor = d.budget ? parseMajorToMinor(d.budget, currency) : null;
  const budgetTooBig = !!budgetMinor && budgetMinor > MAX_MINOR;
  const autoTitle = category && d.workType ? `${catalogName(category, locale)} · ${workTypeLabel(d.workType)}` : '';
  const title = (d.title || scope?.title || autoTitle).slice(0, 100);

  const valid = [!!category, !!d.workType, described, !budgetTooBig, !!address && title.trim().length >= 3];

  // One suggestion per distinct description, asked when the review step opens. It only suggests.
  useEffect(() => {
    if (d.step !== STEPS - 1 || !category || !d.workType) return;
    const text = [d.description, d.voice.transcript].filter(Boolean).join('. ').trim();
    if (!text && !d.photos.length) return;
    const signature = JSON.stringify([d.categoryId, d.workType, text, d.photos.map((p) => p.id)]);
    if (askedFor.current === signature) return;
    askedFor.current = signature;
    setThinking(true);
    api.suggestProjectScope({ categoryId: category.id, workType: d.workType, description: text || undefined, photoUploadIds: d.photos.slice(0, 4).map((p) => p.id), locale })
      .then((r) => setScope(r.suggestion))
      .catch(() => setScope(null))
      .finally(() => setThinking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.step, category?.id]);

  const send = async () => {
    if (!category || !d.workType || !address) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const sent = await submitProject(me?.id ?? '', {
        categoryId: category.id, workType: d.workType, propertyType: d.propertyType, title: title.trim(),
        description: d.description.trim() || undefined, addressId: address.id,
        budgetMax: budgetMinor ?? undefined, startWhen: d.startWhen,
        photoUploadIds: d.photos.map((p) => p.id), audioUploadId: d.voice.audioUploadId,
        audioTranscript: d.voice.audioUploadId ? d.voice.transcript.trim() || undefined : undefined,
        suggestedMilestones: scope?.stages, idempotencyKey: d.idempotencyKey,
      });
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
      setRestored(false); // don't save the finished draft again
      if (sent.queued) {
        Alert.alert(t('offline.requestSaved'));
        router.replace('/(customer)/bookings' as any);
        return;
      }
      void askForPush();
      router.replace(routes.customerProject(sent.result.id) as any);
    } catch (e) { setError(friendlyError(e)); } finally { setSubmitting(false); }
  };

  const back = () => (d.step === 0 ? router.back() : set({ step: d.step - 1 }));
  const tileWidth = Math.floor((width - 40 - 24) / 3);
  const questions = [t('project.q.trade'), t('project.q.kind'), t('project.q.describe'), t('project.q.budget'), t('project.q.review')];
  const unit = 10 ** currencyExponent(currency);

  if (catalog.loading && !catalog.data) return <Screen title={t('project.getWorkDone')} back><LoadingState /></Screen>;
  if (catalog.error && !catalog.data) return <Screen title={t('project.getWorkDone')} back><ErrorState message={catalog.error} onRetry={catalog.reload} /></Screen>;

  const footer = d.step < STEPS - 1
    ? <Button title={t('customerRequestService.continue')} size="lg" disabled={!valid[d.step]} onPress={() => set({ step: d.step + 1 })} />
    : <Button title={t('project.post')} size="lg" variant="accent" loading={submitting} disabled={submitting || !valid.every(Boolean)} onPress={send} />;

  return (
    <Screen footer={footer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <PressableScale onPress={back} accessibilityLabel={t('common.back')} style={{ width: 48, height: 48, justifyContent: 'center' }}>
          <DirIcon name="arrow-back" size={26} color={theme.colors.textPrimary} />
        </PressableScale>
        <View style={{ flex: 1 }}><ProgressBar value={(d.step + 1) / STEPS} label={t('customerRequestService.stepOf', { step: d.step + 1, total: STEPS })} /></View>
      </View>

      <Entrance key={d.step}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: theme.spacing.xl }}>
          <Text variant="h2" weight="bold" style={{ flex: 1 }} accessibilityRole="header">{questions[d.step]}</Text>
          <SpeakButton text={questions[d.step]} />
        </View>

        {d.step === 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {[...(catalog.data ?? [])].sort((a, b) => projectRank(a.name) - projectRank(b.name)).map((c) => (
              <CategoryTile key={c.id} code={c.name} name={catalogName(c, locale)} icon={(c.iconName as any) ?? 'construct'} selected={c.id === d.categoryId}
                style={{ width: tileWidth }} onPress={() => set({ categoryId: c.id, step: 1 })} />
            ))}
          </View>
        ) : null}

        {d.step === 1 ? (
          <View>
            {WORK_TYPES().map((w) => <ChoiceCard key={w.id} icon={w.icon} title={w.title} hint={w.hint} selected={d.workType === w.id} onPress={() => set({ workType: w.id })} speak />)}
            <Text variant="bodyLarge" weight="bold" style={{ marginTop: 12, marginBottom: 10 }}>{t('project.whichPlace')}</Text>
            <ChipChoice options={PROPERTY_TYPES()} selectedIds={[d.propertyType]} onChange={(v) => v[0] && set({ propertyType: v[0] as api.PropertyType })} />
          </View>
        ) : null}

        {d.step === 2 ? (
          <View style={{ gap: theme.spacing.xl }}>
            <VoiceField value={d.voice} onChange={(voice) => set({ voice })} locale={locale} />
            <View style={{ gap: 10 }}>
              <PhotoStrip photos={d.photos.map((p) => ({ id: p.id, uri: p.localUri }))} label={t('project.photo')} onRemove={(id) => set({ photos: d.photos.filter((p) => p.id !== id) })} />
              {d.photos.length < MAX_PHOTOS ? <PhotoButtons onPick={async (src) => { const u = await photoUp.run(src); if (u) setD((cur) => ({ ...cur, photos: [...cur.photos, u].slice(0, MAX_PHOTOS) })); }} busy={photoUp.busy} error={photoUp.error} denied={photoUp.denied} /> : null}
            </View>
            <TextInput label={t('customerRequestService.orWriteAFew')} placeholder={t('project.describeExample')} value={d.description} onChangeText={(description) => set({ description })} multiline maxLength={4000} style={{ minHeight: 90, textAlignVertical: 'top' }} />
          </View>
        ) : null}

        {d.step === 3 ? (
          <View>
            <AmountField label={t('project.budgetOptional', { currency })} value={d.budget} onChangeText={(budget) => set({ budget })} currency={currency}
              quick={currency === 'PKR' ? [25_000, 100_000, 500_000, 1_000_000] : []} error={budgetTooBig ? t('project.budgetTooBig', { max: formatMoney(MAX_MINOR - (MAX_MINOR % unit), currency, locale) }) : undefined} />
            <Button title={t('project.notSureBudget')} variant="ghost" onPress={() => set({ budget: '' })} />
            <Text variant="bodyLarge" weight="bold" style={{ marginTop: 20, marginBottom: 10 }}>{t('project.startWhen')}</Text>
            <ChipChoice options={START_WHEN()} selectedIds={[d.startWhen]} onChange={(v) => v[0] && set({ startWhen: v[0] as api.StartWhen })} />
          </View>
        ) : null}

        {d.step === 4 && category && d.workType ? (
          <View>
            <TextInput label={t('project.titleLabel')} value={title} onChangeText={(v) => set({ title: v })} maxLength={100} />

            <Text variant="bodyLarge" weight="bold" style={{ marginTop: 20, marginBottom: 8 }}>{t('customerRequestService.where')}</Text>
            {addresses.loading && !addresses.data ? <LoadingState /> : (addresses.data ?? []).map((a) => (
              <ChoiceCard key={a.id} icon="location" title={a.label ?? t('customerRequestService.address')} hint={[a.streetAddress, a.area, a.city].filter(Boolean).join(', ')} selected={a.id === d.addressId} onPress={() => set({ addressId: a.id })} />
            ))}
            <Button title={addresses.data?.length ? t('customerRequestService.addAnotherAddress') : t('customerRequestService.addYourAddress')} variant={addresses.data?.length ? 'ghost' : 'primary'}
              onPress={() => router.push('/address-edit' as any)} />

            {thinking ? <LoadingState message={t('project.suggesting')} /> : null}
            {scope ? (
              <Card tint={theme.colors.primarySoft} style={{ marginTop: 16, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="sparkles" size={18} color={theme.colors.primaryText} />
                  <Text variant="body" weight="bold" color={theme.colors.primaryText}>{t('project.suggestedStages')}</Text>
                </View>
                {scope.stages.map((s, i) => <Text key={i} variant="body">{i + 1}. {s.title} — {s.percent}%</Text>)}
                <Text variant="caption" color={theme.colors.textSecondary}>{t('project.suggestedHint')}</Text>
                <Button title={t('project.removeSuggestion')} size="sm" variant="ghost" onPress={() => setScope(null)} />
              </Card>
            ) : null}

            <Card style={{ marginTop: 16, gap: 6 }}>
              <Text variant="body" weight="semibold">{catalogName(category, locale)} · {workTypeLabel(d.workType)}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('project.budget')}: {budgetMinor ? formatMoney(budgetMinor, currency, locale) : t('project.budgetOpen')}</Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('project.addressLater')}</Text>
            </Card>
            {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
          </View>
        ) : null}
      </Entrance>
    </Screen>
  );
}
