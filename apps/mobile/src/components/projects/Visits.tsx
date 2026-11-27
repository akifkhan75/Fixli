import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { friendlyError } from '../../hooks/useApi';
import * as api from '../../services/api';
import { Card } from '../ds/Card';
import { Text } from '../ds/Text';
import { TextInput } from '../ds/TextInput';
import { Button } from '../ds/Button';
import { ChipChoice } from '../ds/ChipChoice';

const HOURS = [9, 11, 14, 17];

/** Site visits: long work takes several, and both sides need to know when. */
export function Visits({ project, onChanged }: { project: api.ProjectView; onChanged: () => unknown }) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const editable = project.status === 'AWARDED' || project.status === 'IN_PROGRESS';
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState('1');
  const [hour, setHour] = useState('9');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    return { id: String(i + 1), label: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date) };
  }), [locale]);
  const timeLabel = (h: number) => new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2027, 0, 1, h));

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try { await work(); await onChanged(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const plan = () => run(async () => {
    const at = new Date();
    at.setDate(at.getDate() + Number(day));
    at.setHours(Number(hour), 0, 0, 0);
    await api.addVisit(project.id, at.toISOString(), note.trim() || undefined);
    setAdding(false);
    setNote('');
  });

  const shown = project.visits.filter((v) => v.status !== 'CANCELLED');
  if (!editable && !shown.length) return null;

  return (
    <View style={{ marginTop: theme.spacing['2xl'] }}>
      <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('visits.title')}</Text>
      {shown.map((v) => (
        <Card key={v.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={v.status === 'DONE' ? 'checkmark-circle' : 'calendar'} size={24} color={v.status === 'DONE' ? theme.colors.successText : theme.colors.primaryText} />
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="semibold">{new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(v.scheduledAt))}</Text>
              {v.note ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{v.note}</Text> : null}
            </View>
          </View>
          {editable && v.status === 'PLANNED' ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}><Button title={t('visits.done')} size="sm" variant="tinted" disabled={busy} onPress={() => run(() => api.updateVisit(project.id, v.id, 'DONE'))} /></View>
              <View style={{ flex: 1 }}><Button title={t('visits.cancel')} size="sm" variant="ghost" disabled={busy} onPress={() => run(() => api.updateVisit(project.id, v.id, 'CANCELLED'))} /></View>
            </View>
          ) : null}
        </Card>
      ))}
      {!shown.length ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('visits.empty')}</Text> : null}
      {editable ? (adding ? (
        <Card style={{ gap: 10, marginTop: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}><ChipChoice options={days} selectedIds={[day]} onChange={(v) => v[0] && setDay(v[0])} /></ScrollView>
          <ChipChoice options={HOURS.map((h) => ({ id: String(h), label: timeLabel(h) }))} selectedIds={[hour]} onChange={(v) => v[0] && setHour(v[0])} />
          <TextInput label={t('visits.note')} value={note} onChangeText={setNote} maxLength={300} />
          <Button title={t('visits.add')} loading={busy} disabled={busy} onPress={plan} />
        </Card>
      ) : <Button title={t('visits.add')} variant="ghost" onPress={() => setAdding(true)} leftIcon={<Ionicons name="add" size={20} color={theme.colors.primaryText} />} />) : null}
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
