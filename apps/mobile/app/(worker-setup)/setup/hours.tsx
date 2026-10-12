import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { LoadingState } from '../../../src/components/ds/EmptyState';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

const DAYS = () => ([
  { id: '1', label: t('workerSetupHours.mon') }, { id: '2', label: t('workerSetupHours.tue') }, { id: '3', label: t('workerSetupHours.wed') }, { id: '4', label: t('workerSetupHours.thu') },
  { id: '5', label: t('workerSetupHours.fri') }, { id: '6', label: t('workerSetupHours.sat') }, { id: '0', label: t('workerSetupHours.sun') },
]);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
const STARTS = [6, 7, 8, 9, 10, 11, 12].map((h) => ({ id: String(h), label: hourLabel(h) }));
const ENDS = [14, 16, 17, 18, 19, 20, 21, 22].map((h) => ({ id: String(h), label: hourLabel(h) }));

export default function HoursScreen() {
  const theme = useTheme();
  const me = useApi(api.getWorkerMe);
  const [days, setDays] = useState<string[]>(['1', '2', '3', '4', '5', '6']);
  const [start, setStart] = useState<string[]>(['9']);
  const [end, setEnd] = useState<string[]>(['18']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const hours = me.data?.workingHours;
    if (!hours?.length) return;
    setDays(hours.map((h) => String(h.weekday)));
    setStart([String(Math.floor(hours[0].startMinute / 60))]);
    setEnd([String(Math.floor(hours[0].endMinute / 60))]);
  }, [me.data]);

  if (me.loading && !me.data) return <Screen title={t('workerSetupHours.workingHours')} back><LoadingState /></Screen>;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.setWorkerHours(days.map((d) => ({ weekday: Number(d), startMinute: Number(start[0]) * 60, endMinute: Number(end[0]) * 60 })));
      router.back();
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <Screen title={t('workerSetupHours.workingHours')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving || !days.length || !start[0] || !end[0]} onPress={save} />}>
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginBottom: 12 }}>{t('workerSetupHours.whichDaysDoYou')}</Text>
      <ChipChoice multiSelect options={DAYS()} selectedIds={days} onChange={setDays} />
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 28, marginBottom: 12 }}>{t('workerSetupHours.startTime')}</Text>
      <ChipChoice options={STARTS} selectedIds={start} onChange={setStart} />
      <Text variant="bodyLarge" weight="semibold" color={theme.colors.textPrimary} style={{ marginTop: 28, marginBottom: 12 }}>{t('workerSetupHours.finishTime')}</Text>
      <ChipChoice options={ENDS} selectedIds={end} onChange={setEnd} />
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
