import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { currencyExponent, formatMoney, parseMajorToMinor } from '../../utils/money';
import { splitByPercent } from '../../utils/projectStatus';
import type { ProjectView } from '../../services/api';
import { Text } from '../ds/Text';
import { TextInput } from '../ds/TextInput';
import { Button } from '../ds/Button';
import { ChipChoice } from '../ds/ChipChoice';
import { AmountField, toMajorText } from '../ds/AmountField';
import { PressableScale } from '../motion/PressableScale';

const DAYS = [1, 3, 7, 14, 30, 60, 90];
const MAX_STAGES = 10;

interface Stage { key: number; title: string; amount: string }

/**
 * A professional's price: one total, how long, and optionally payment stages. Stages follow the
 * total automatically (from the suggested split) until the person edits one themselves.
 */
export function BidForm({ project, busy, onSubmit }: {
  project: ProjectView; busy: boolean;
  onSubmit: (bid: { totalAmount: number; durationDays: number; note?: string; milestones?: { title: string; amount: number }[] }) => void;
}) {
  const theme = useTheme();
  const { t, tn, locale } = useI18n();
  const { currency } = project;
  const unit = 10 ** currencyExponent(currency);
  const mine = project.myBid;
  const [total, setTotal] = useState(mine ? toMajorText(mine.totalAmount, currency) : '');
  const [days, setDays] = useState(String(mine?.durationDays ?? 7));
  const [note, setNote] = useState(mine?.note ?? '');
  // null = automatic: derived from the total and the suggested percentages.
  const [custom, setCustom] = useState<Stage[] | null>(
    mine && mine.milestones.length > 1 ? mine.milestones.map((m, i) => ({ key: i, title: m.title, amount: toMajorText(m.amount, currency) })) : null,
  );
  const [tried, setTried] = useState(false);

  const totalMinor = parseMajorToMinor(total, currency);
  const suggested = project.suggestedMilestones?.length ? project.suggestedMilestones : [{ title: project.title.slice(0, 80), percent: 100 }];
  const auto: Stage[] = splitByPercent(totalMinor ?? 0, suggested, unit).map((s, i) => ({ key: i, title: s.title, amount: s.amount ? toMajorText(s.amount, currency) : '' }));
  const stages = custom ?? auto;
  const parsed = stages.map((s) => ({ title: s.title.trim(), amount: parseMajorToMinor(s.amount, currency) }));
  const sum = parsed.reduce((n, s) => n + (s.amount ?? 0), 0);
  // The automatic split is exact by construction (the last stage takes the remainder).
  const exact = !custom || (parsed.every((s) => s.title && s.amount) && sum === totalMinor);

  const edit = (key: number, patch: Partial<Stage>) => setCustom(stages.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const submit = () => {
    setTried(true);
    if (!totalMinor || !exact) return;
    const milestones = custom
      ? parsed.map((s) => ({ title: s.title, amount: s.amount! }))
      : splitByPercent(totalMinor, suggested, unit).filter((s) => s.amount > 0);
    onSubmit({ totalAmount: totalMinor, durationDays: Number(days), note: note.trim() || undefined, milestones: milestones.length ? milestones : undefined });
  };

  return (
    <View>
      <AmountField testID="bid-total" label={t('project.totalPrice', { currency })} value={total} onChangeText={setTotal} currency={currency} error={tried && !totalMinor ? t('priceForm.enterYourPriceFor') : undefined} />

      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 20, marginBottom: 8 }}>{t('project.howLong')}</Text>
      <ChipChoice options={DAYS.map((d) => ({ id: String(d), label: tn('project.days', d) }))} selectedIds={[days]} onChange={(v) => v[0] && setDays(v[0])} />

      <Text variant="bodyLarge" weight="bold" style={{ marginTop: 20 }}>{t('project.stages')}</Text>
      <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginBottom: 10 }}>{t('project.stagesHint')}</Text>
      {stages.map((s, i) => (
        <View key={s.key} style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.lg, padding: 12, marginBottom: 10, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="body" weight="bold" style={{ flex: 1 }}>{t('project.stageN', { n: i + 1 })}</Text>
            {stages.length > 1 ? (
              <PressableScale onPress={() => setCustom(stages.filter((x) => x.key !== s.key))} accessibilityLabel={t('project.removeStage')} hitSlop={10} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="trash-outline" size={20} color={theme.colors.errorText} />
              </PressableScale>
            ) : null}
          </View>
          <TextInput label={t('project.stageName')} value={s.title} onChangeText={(title) => edit(s.key, { title })} maxLength={80} />
          <AmountField label={t('project.stageAmount')} value={s.amount} onChangeText={(amount) => edit(s.key, { amount })} currency={currency} />
        </View>
      ))}
      {stages.length < MAX_STAGES ? (
        <Button title={t('project.addStage')} variant="ghost" leftIcon={<Ionicons name="add" size={20} color={theme.colors.primaryText} />}
          onPress={() => setCustom([...stages, { key: Math.max(0, ...stages.map((s) => s.key)) + 1, title: '', amount: '' }])} />
      ) : null}
      {custom && totalMinor && sum !== totalMinor ? (
        <Text variant="bodySmall" weight="semibold" color={theme.colors.errorText} accessibilityRole="alert">
          {t('project.stagesDiffer', { sum: formatMoney(sum, currency, locale), total: formatMoney(totalMinor, currency, locale) })}
        </Text>
      ) : null}
      {custom ? <Button title={t('project.autoSplit')} variant="ghost" onPress={() => setCustom(null)} /> : null}

      <View style={{ marginTop: 12 }}>
        <TextInput label={t('priceForm.noteForTheCustomer')} value={note} onChangeText={setNote} maxLength={1000} multiline />
      </View>
      <View style={{ marginTop: 16 }}>
        <Button title={mine?.status === 'PENDING' ? t('project.updatePrice') : t('project.sendPrice')} size="lg" loading={busy} disabled={busy} onPress={submit} />
      </View>
    </View>
  );
}
