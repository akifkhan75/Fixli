import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { friendlyError } from '../../hooks/useApi';
import * as api from '../../services/api';
import { Button } from './Button';
import { ChipChoice } from './ChipChoice';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { t } from '../../i18n';

const CATEGORIES = (): { id: api.DisputeCategory; label: string }[] => ([
  { id: 'QUALITY', label: t('reportProblem.theWorkIsNot') },
  { id: 'DAMAGE', label: t('reportProblem.somethingWasDamaged') },
  { id: 'PRICE', label: t('reportProblem.thePriceIsWrong') },
  { id: 'NO_SHOW', label: t('reportProblem.theyDidntCome') },
  { id: 'BEHAVIOUR', label: t('reportProblem.behaviour') },
  { id: 'OTHER', label: t('customerHomeCategories.somethingElse') },
]);

/** Report a problem with a job. Fixli support follows up; it stops the job auto-completing meanwhile. */
export function ReportProblem({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  if (sent) return <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 16 }}>{t('reportProblem.thanksFixliSupportWill')}</Text>;
  if (!open) return <View style={{ marginTop: 16 }}><Button title={t('reportProblem.reportAProblem')} variant="ghost" onPress={() => setOpen(true)} /></View>;

  const send = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.openDispute({ jobRequestId: jobId, category: category[0] as api.DisputeCategory, reason: reason.trim() });
      setSent(true);
      onDone();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ marginTop: 16, backgroundColor: theme.colors.surfaceElevated, padding: 16, borderRadius: theme.borderRadius.lg, gap: 12 }}>
      <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>{t('reportProblem.whatWentWrong')}</Text>
      <ChipChoice options={CATEGORIES()} selectedIds={category} onChange={setCategory} />
      <TextInput label={t('reportProblem.tellUsMore')} value={reason} onChangeText={setReason} multiline maxLength={120} />
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Button title={t('changeOrderForm.cancel')} variant="secondary" disabled={busy} onPress={() => setOpen(false)} /></View>
        <View style={{ flex: 1 }}><Button title={t('chatThreadScreen.send')} variant="primary" loading={busy} disabled={busy || !category[0] || reason.trim().length < 3} onPress={send} /></View>
      </View>
    </View>
  );
}
