import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { StepHeader } from '../../../src/components/ds/StepHeader';
import { LoadingState } from '../../../src/components/ds/EmptyState';
import { equipmentSuggestionsFor, normalizeEquipment } from '../../../src/utils/equipmentSuggestions';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

const MAX = 30;

export default function ToolsScreen() {
  const theme = useTheme();
  const me = useApi(api.getWorkerMe);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (me.data?.equipment) setSelected(me.data.equipment);
  }, [me.data]);

  const suggestions = useMemo(
    () => equipmentSuggestionsFor((me.data?.services ?? []).map((s) => s.category.name)),
    [me.data?.services],
  );

  const suggestionOptions = useMemo(() => {
    const extras = selected.filter((s) => !suggestions.includes(s));
    return [...suggestions, ...extras].map((label) => ({ id: label, label }));
  }, [suggestions, selected]);

  if (me.loading && !me.data) {
    return (
      <Screen title={t('workerSetupTools.yourTools')} back>
        <LoadingState />
      </Screen>
    );
  }

  const addCustom = () => {
    const next = normalizeEquipment([...selected, custom], MAX);
    setSelected(next);
    setCustom('');
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.patchWorkerMe({ equipment: normalizeEquipment(selected, MAX) });
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title={t('workerSetupTools.yourTools')}
      back
      footer={
        <Button
          title={t('sharedEditProfile.save')}
          size="lg"
          variant="primary"
          loading={saving}
          disabled={saving}
          onPress={save}
        />
      }
    >
      <StepHeader question={t('workerSetupTools.question')} help={t('workerSetupTools.help')} />

      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginBottom: 8 }}>
        {t('workerSetupTools.suggestedForYourSkills')}
      </Text>
      <ChipChoice multiSelect options={suggestionOptions} selectedIds={selected} onChange={(ids) => setSelected(normalizeEquipment(ids, MAX))} />

      <View style={{ marginTop: 24, flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <TextInput
            label={t('workerSetupTools.addYourOwn')}
            placeholder={t('workerSetupTools.eGSprayGun')}
            value={custom}
            onChangeText={setCustom}
            maxLength={60}
            onSubmitEditing={addCustom}
            returnKeyType="done"
          />
        </View>
        <Pressable
          onPress={addCustom}
          disabled={!custom.trim() || selected.length >= MAX}
          accessibilityRole="button"
          accessibilityLabel={t('workerSetupTools.add')}
          style={{
            height: 48,
            paddingHorizontal: 16,
            borderRadius: theme.borderRadius.lg,
            backgroundColor: custom.trim() && selected.length < MAX ? theme.colors.primary : theme.colors.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 2,
          }}
        >
          <Ionicons name="add" size={24} color={custom.trim() && selected.length < MAX ? theme.colors.onPrimary : theme.colors.textTertiary} />
        </Pressable>
      </View>

      <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 12 }}>
        {t('workerSetupTools.count', { n: selected.length, max: MAX })}
      </Text>
      {error ? (
        <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
