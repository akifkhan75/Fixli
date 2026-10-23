import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../../src/hooks/useApi';
import { Screen } from '../../../src/components/ds/Screen';
import { Text } from '../../../src/components/ds/Text';
import { Button } from '../../../src/components/ds/Button';
import { TextInput } from '../../../src/components/ds/TextInput';
import { ChipChoice } from '../../../src/components/ds/ChipChoice';
import { LoadingState } from '../../../src/components/ds/EmptyState';
import { openSettings } from '../../../src/services/pickPhoto';
import * as api from '../../../src/services/api';
import { t } from '../../../src/i18n';

const RADII = () => ([{ id: '3', label: t('workerSetupArea.3Km') }, { id: '5', label: t('workerSetupArea.5Km') }, { id: '10', label: t('workerSetupArea.10Km') }, { id: '20', label: t('workerSetupArea.20Km') }]);

export default function AreaScreen() {
  const theme = useTheme();
  const me = useApi(api.getWorkerMe);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [label, setLabel] = useState('');
  const [radius, setRadius] = useState<string[]>(['10']);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | undefined>();
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const w = me.data;
    if (!w) return;
    if (w.serviceLat != null && w.serviceLng != null) setCoords({ latitude: w.serviceLat, longitude: w.serviceLng });
    setLabel(w.serviceAreaLabel ?? '');
    setRadius([String(w.serviceRadius)]);
  }, [me.data]);

  if (me.loading && !me.data) return <Screen title={t('workerSetupArea.whereYouWork')} back><LoadingState /></Screen>;

  const locate = async () => {
    setLocError(undefined);
    setDenied(false);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setDenied(true);
        setLocError(t('workerSetupArea.locationIsOffTurn'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      const [place] = await Location.reverseGeocodeAsync(pos.coords).catch(() => []);
      if (place && !label.trim()) setLabel([place.district ?? place.subregion, place.city ?? place.region].filter(Boolean).join(', '));
    } catch {
      setLocError(t('workerSetupArea.weCouldntFindYour'));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!coords) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.patchWorkerMe({ serviceLat: coords.latitude, serviceLng: coords.longitude, serviceAreaLabel: label.trim() || undefined, serviceRadius: Number(radius[0] ?? 10) });
      router.back();
    } catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <Screen title={t('workerSetupArea.whereYouWork')} back footer={<Button title={t('sharedEditProfile.save')} size="lg" variant="primary" loading={saving} disabled={saving || !coords} onPress={save} />}>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginBottom: 16 }}>{t('workerSetupArea.standAtThePlace')}</Text>
      <Button title={coords ? t('sharedAddressEdit.locationSavedUpdateIt') : t('sharedAddressEdit.useMyCurrentLocation')} variant={coords ? 'secondary' : 'primary'} size="lg" loading={locating} disabled={locating} onPress={locate}
        leftIcon={<Ionicons name="navigate" size={20} color={coords ? theme.colors.primary : '#FFF'} />} />
      {locError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 8 }}>{locError}</Text> : null}
      {denied ? <Button title={t('sharedAddressEdit.openSettings')} variant="ghost" onPress={openSettings} /> : null}

      <View style={{ height: 20 }} />
      <TextInput label={t('workerSetupArea.areaName')} placeholder={t('workerSetupArea.eGGulshanE')} value={label} onChangeText={setLabel} />
      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>{t('workerSetupArea.howFarWillYou')}</Text>
      <ChipChoice options={RADII()} selectedIds={radius} onChange={setRadius} />
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 16 }}>{error}</Text> : null}
    </Screen>
  );
}

