import React, { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useI18n } from '../../../src/hooks/useI18n';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { useSetupNext } from '../../../src/hooks/useSetupNext';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { CategoryTile } from '../../../src/components/ds/CategoryTile';
import { StepHeader } from '../../../src/components/ds/StepHeader';
import { ErrorState, LoadingState } from '../../../src/components/ds/EmptyState';
import { catalogName } from '../../../src/utils/catalog';
import * as api from '../../../src/services/api';

const MAX_SKILLS = 12;

export default function SkillsScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { width } = useWindowDimensions();
  const goNext = useSetupNext();
  const catalog = useApi(api.getCatalog, [], { cacheKey: 'catalog' });
  const me = useApi(api.getWorkerMe);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => { if (me.data) setSelected(me.data.services.map((s) => s.category.id)); }, [me.data]);

  if ((catalog.loading || me.loading) && !catalog.data) return <Screen title={t('workerSetup.whatYouFix')} back><LoadingState /></Screen>;
  if ((catalog.error || me.error) && !catalog.data) return <Screen title={t('workerSetup.whatYouFix')} back><ErrorState message={(catalog.error ?? me.error)!} onRetry={() => { catalog.reload(); me.reload(); }} /></Screen>;

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX_SKILLS ? [...cur, id] : cur));
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try { goNext(await api.setWorkerSkills(selected)); } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };
  const tileWidth = Math.floor((width - 40 - 24) / 3);

  return (
    <Screen title={t('workerSetup.whatYouFix')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving || selected.length === 0} onPress={save} />}>
      <StepHeader question={t('workerSetupSkills.question')} help={t('workerSetupSkills.chooseEveryKindOf')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {(catalog.data ?? []).map((c) => (
          <CategoryTile key={c.id} code={c.name} name={catalogName(c, locale)} icon={(c.iconName as any) ?? 'construct'} selected={selected.includes(c.id)} style={{ width: tileWidth }} onPress={() => toggle(c.id)} />
        ))}
      </View>
      {selected.length >= MAX_SKILLS ? <Text variant="bodySmall" color={theme.colors.warningText} style={{ marginTop: 12 }}>{t('workerSetupSkills.max', { n: MAX_SKILLS })}</Text> : null}
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}
