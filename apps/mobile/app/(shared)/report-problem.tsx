import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { friendlyError } from '../../src/hooks/useApi';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { TextInput } from '../../src/components/ds/TextInput';
import * as api from '../../src/services/api';
import { AnalyticsService } from '../../src/services/productAnalytics';
import { useI18n } from '../../src/hooks/useI18n';

/** Tell Fixli about a problem with a job. Opens a report the support team reviews (doc 27 R6). */
export default function ReportProblemScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const theme = useTheme();
  const { t } = useI18n();
  const [category, setCategory] = useState<api.DisputeCategory | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!category || !jobId) return;
    setBusy(true); setError(undefined);
    try {
      const label = api.DISPUTE_CATEGORIES.find((c) => c.id === category)!.label;
      AnalyticsService.track('dispute_opened', { category });
      await api.createDispute({ jobRequestId: jobId, category, reason: label, description: description.trim() || undefined });
      setDone(true);
    } catch (e) {
      // Already reported: that is the answer they need, not an error.
      if (e instanceof api.ApiError && e.code === 'DISPUTE_EXISTS') setDone(true);
      else setError(friendlyError(e));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Screen title={t('report.title')} back>
        <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>{t('report.done.title')}</Text>
        <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
          {t('report.done.message')}
        </Text>
        <View style={{ marginTop: 24, gap: 12 }}>
          <Button title={t('report.seeReports')} variant="primary" size="lg" onPress={() => router.replace('/disputes' as any)} />
          <Button title={t('report.backToJob')} variant="secondary" size="lg" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t('report.title')} back footer={<Button title={t('report.send')} variant="primary" size="lg" loading={busy} disabled={busy || !category} onPress={submit} />}>
      <Text variant="body" color={theme.colors.textSecondary}>
        {t('report.intro')}
      </Text>
      <View style={{ marginTop: 16, gap: 8 }}>
        {api.DISPUTE_CATEGORIES.map((c) => {
          const on = category === c.id;
          return (
            <Button key={c.id} title={c.label} variant={on ? 'primary' : 'secondary'} size="md" onPress={() => setCategory(c.id)} />
          );
        })}
      </View>
      <View style={{ marginTop: 20 }}>
        <TextInput label={t('report.more')} value={description} onChangeText={setDescription} multiline maxLength={2000} style={{ minHeight: 96, textAlignVertical: 'top' }} />
      </View>
      {error ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 12 }}>{error}</Text> : null}
    </Screen>
  );
}
