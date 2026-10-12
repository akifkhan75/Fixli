import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useI18n } from '../../../src/hooks/useI18n';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { humanize, localizedName } from '../../../src/utils/catalog';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

export default function SkillsScreen() {
  const theme = useTheme();
  const { locale } = useI18n();
  const catalog = useApi(api.getCatalog);
  const me = useApi(api.getWorkerMe);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => { if (me.data) setSelected(me.data.services.map((s) => s.category.id)); }, [me.data]);

  if ((catalog.loading || me.loading) && !catalog.data) return <Screen title={t('workerSetup.whatYouFix')} back><LoadingState /></Screen>;
  if ((catalog.error || me.error) && !catalog.data) return <Screen title={t('workerSetup.whatYouFix')} back><ErrorState message={(catalog.error ?? me.error)!} onRetry={() => { catalog.reload(); me.reload(); }} /></Screen>;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try { await api.setWorkerSkills(selected); router.back(); } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <Screen title={t('workerSetup.whatYouFix')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving || selected.length === 0} onPress={save} />}>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 16 }}>{t('workerSetupSkills.chooseEveryKindOf')}</Text>
      <ChipChoice
        multiSelect
        options={(catalog.data ?? []).map((c) => ({ id: c.id, label: localizedName({ name: c.translations?.en?.name ?? humanize(c.name), translations: c.translations }, locale) }))}
        selectedIds={selected}
        onChange={setSelected}
      />
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
