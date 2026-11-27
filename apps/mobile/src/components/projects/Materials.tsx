import React, { useState } from 'react';
import { View } from 'react-native';
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
import { PressableScale } from '../motion/PressableScale';

/** The shared materials list: what is needed, who buys it, and whether it's on site. */
export function Materials({ project, userId, onChanged }: { project: api.ProjectView; userId: string; onChanged: () => unknown }) {
  const theme = useTheme();
  const { t } = useI18n();
  const editable = project.status !== 'COMPLETED' && project.status !== 'CANCELLED';
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('');
  const [who, setWho] = useState<'customer' | 'worker'>('customer');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const quantity = Number(qty);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try { await work(); await onChanged(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  if (!editable && !project.materials.length) return null;

  return (
    <View style={{ marginTop: theme.spacing['2xl'] }}>
      <Text variant="h3" weight="bold" style={{ marginBottom: theme.spacing.md }}>{t('materials.title')}</Text>
      {project.materials.map((m) => (
        <Card key={m.id} style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 }}>
          <PressableScale disabled={!editable || busy} onPress={() => run(() => api.setMaterialReady(project.id, m.id, !m.isReady))} accessibilityRole="checkbox" accessibilityState={{ checked: m.isReady }} accessibilityLabel={m.name}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={m.isReady ? 'checkbox' : 'square-outline'} size={28} color={m.isReady ? theme.colors.successText : theme.colors.textTertiary} />
          </PressableScale>
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold">{m.name}</Text>
            <Text variant="caption" color={theme.colors.textSecondary}>{m.quantity} {m.unit ?? ''} · {m.providedBy === 'customer' ? t('materials.customerBuys') : t('materials.workerBuys')}</Text>
          </View>
          {editable && m.addedById === userId ? (
            <PressableScale disabled={busy} onPress={() => run(() => api.removeMaterial(project.id, m.id))} accessibilityLabel={t('materials.remove', { name: m.name })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="trash-outline" size={20} color={theme.colors.errorText} />
            </PressableScale>
          ) : null}
        </Card>
      ))}
      {!project.materials.length ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{t('materials.empty')}</Text> : null}
      {editable ? (adding ? (
        <Card style={{ gap: 10, marginTop: 8 }}>
          <TextInput label={t('materials.name')} value={name} onChangeText={setName} maxLength={100} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><TextInput label={t('materials.quantity')} keyboardType="decimal-pad" value={qty} onChangeText={(v) => setQty(v.replace(/[^\d.]/g, ''))} /></View>
            <View style={{ flex: 1 }}><TextInput label={t('materials.unit')} value={unit} onChangeText={setUnit} maxLength={20} /></View>
          </View>
          <ChipChoice options={[{ id: 'customer', label: t('materials.customerBuys') }, { id: 'worker', label: t('materials.workerBuys') }]} selectedIds={[who]} onChange={(v) => v[0] && setWho(v[0] as 'customer' | 'worker')} />
          <Button title={t('materials.add')} loading={busy} disabled={busy || !name.trim() || !(quantity > 0)}
            onPress={() => run(async () => { await api.addMaterial(project.id, { name: name.trim(), quantity, unit: unit.trim() || undefined, providedBy: who }); setName(''); setQty('1'); setUnit(''); setAdding(false); })} />
        </Card>
      ) : <Button title={t('materials.add')} variant="ghost" onPress={() => setAdding(true)} leftIcon={<Ionicons name="add" size={20} color={theme.colors.primaryText} />} />) : null}
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
