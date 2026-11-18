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
import { AnalyticsService } from '../../src/services/analytics';

/** Tell Fixli about a problem with a job. Opens a report the support team reviews (doc 27 R6). */
export default function ReportProblemScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const theme = useTheme();
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
      <Screen title="Report a problem" back>
        <Text variant="h2" weight="bold" color={theme.colors.textPrimary}>We got your report</Text>
        <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
          Our team will look at it and update you. You can follow it under "My reports".
        </Text>
        <View style={{ marginTop: 24, gap: 12 }}>
          <Button title="See my reports" variant="primary" size="lg" onPress={() => router.replace('/disputes' as any)} />
          <Button title="Back to the job" variant="secondary" size="lg" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Report a problem" back footer={<Button title="Send report" variant="primary" size="lg" loading={busy} disabled={busy || !category} onPress={submit} />}>
      <Text variant="body" color={theme.colors.textSecondary}>
        What went wrong? If anyone is in danger, use the SOS button or call emergency services first.
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
        <TextInput label="Tell us more (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} style={{ minHeight: 96, textAlignVertical: 'top' }} />
      </View>
      {error ? <Text variant="bodySmall" color={theme.colors.error} accessibilityRole="alert" style={{ marginTop: 12 }}>{error}</Text> : null}
    </Screen>
  );
}
