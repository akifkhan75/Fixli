import React, { useState } from 'react';
import { View, Switch } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useApi, friendlyError } from '../../src/hooks/useApi';
import { useCountry } from '../../src/hooks/useCountry';
import { Screen } from '../../src/components/ds/Screen';
import { Text } from '../../src/components/ds/Text';
import { Button } from '../../src/components/ds/Button';
import { TextInput } from '../../src/components/ds/TextInput';
import { ChipChoice } from '../../src/components/ds/ChipChoice';
import { LoadingState } from '../../src/components/ds/EmptyState';
import { openSettings } from '../../src/services/pickPhoto';
import * as api from '../../src/services/api';
import { t } from '../../src/i18n';

const LABELS = () => ([{ id: 'Home', label: t('sharedAddressEdit.home') }, { id: 'Work', label: t('sharedAddressEdit.work') }, { id: 'Other', label: t('sharedAddressEdit.other') }]);

export default function AddressEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const { country } = useCountry();
  const existing = useApi(async () => (id ? (await api.getAddresses()).find((a) => a.id === id) ?? null : null), [id]);

  if (id && existing.loading) return <Screen title={t('customerRequestService.address')} back><LoadingState /></Screen>;
  return <Form key={id ?? 'new'} initial={existing.data ?? undefined} id={id} countryCode={country} />;
}

function Form({ initial, id, countryCode }: { initial?: api.Address; id?: string; countryCode: string }) {
  const theme = useTheme();
  const [label, setLabel] = useState<string[]>([initial?.label ?? 'Home']);
  const [street, setStreet] = useState(initial?.streetAddress ?? '');
  const [building, setBuilding] = useState(initial?.buildingDetail ?? '');
  const [area, setArea] = useState(initial?.area ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [landmark, setLandmark] = useState(initial?.landmark ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    initial?.latitude != null && initial?.longitude != null ? { latitude: initial.latitude, longitude: initial.longitude } : null,
  );
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | undefined>();
  const [denied, setDenied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const streetError = submitted && !street.trim() ? 'Enter your street or house number.' : undefined;
  const cityError = submitted && !city.trim() ? 'Enter your city.' : undefined;
  const coordsError = submitted && !coords ? t('sharedAddressEdit.locationRequired') : undefined;

  const useMyLocation = async () => {
    setLocError(undefined);
    setDenied(false);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setDenied(true);
        setLocError(t('sharedAddressEdit.locationIsOffYou'));
        return;
      }
      // getCurrentPositionAsync can hang indefinitely on weak GPS (common on Android), which
      // leaves the button spinning and the address impossible to save. Cap the wait and fall
      // back to the last known fix.
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
      ]).catch(() => null);
      const pos = fresh ?? (await Location.getLastKnownPositionAsync().catch(() => null));
      if (!pos) {
        setLocError(t('sharedAddressEdit.weCouldntFindYour'));
        return;
      }
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      // Fill what we can, but never overwrite what the person already typed.
      const [place] = await Location.reverseGeocodeAsync(pos.coords).catch(() => []);
      if (place) {
        if (!street.trim()) setStreet([place.streetNumber, place.street].filter(Boolean).join(' ') || place.name || '');
        if (!area.trim()) setArea(place.district ?? place.subregion ?? '');
        if (!city.trim()) setCity(place.city ?? place.region ?? '');
      }
    } catch {
      setLocError(t('sharedAddressEdit.weCouldntFindYour'));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    setSubmitted(true);
    // The blocking requirement (missing map location) lives at the top of the form, far from
    // the Save button in the footer. Echo it next to the button so tapping Save never looks
    // like it did nothing — the usual "my address won't save" report.
    if (!street.trim() || !city.trim() || !coords) {
      setError(!coords ? t('sharedAddressEdit.locationRequired') : t('sharedAddressEdit.checkHighlightedFields'));
      return;
    }
    setError(undefined);
    setSaving(true);
    setError(undefined);
    try {
      const body = {
        label: label[0] ?? 'Home', /* i18n-ignore: stored id, not text shown */ streetAddress: street.trim(), city: city.trim(), country: countryCode,
        area: area.trim() || undefined, buildingDetail: building.trim() || undefined, landmark: landmark.trim() || undefined,
        latitude: coords.latitude, longitude: coords.longitude, isDefault,
      };
      if (id) await api.updateAddress(id, body); else await api.createAddress(body);
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    setSaving(true);
    try { await api.deleteAddress(id); router.back(); } catch (e) { setError(friendlyError(e)); setSaving(false); }
  };

  return (
    <Screen
      title={id ? t('sharedAddressEdit.editAddress') : t('sharedAddressEdit.newAddress')}
      back
      footer={
        <View>
          {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginBottom: 10 }}>{error}</Text> : null}
          <Button title={t('sharedAddressEdit.saveAddress')} size="lg" variant="primary" loading={saving} disabled={saving} onPress={save} />
        </View>
      }
    >
      <Button
        title={coords ? t('sharedAddressEdit.locationSavedUpdateIt') : t('sharedAddressEdit.useMyCurrentLocation')}
        variant="secondary" size="lg" loading={locating} disabled={locating} onPress={useMyLocation}
        leftIcon={<Ionicons name="navigate" size={20} color={theme.colors.primary} />}
      />
      {locError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 8 }}>{locError}</Text> : null}
      {coordsError ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert" style={{ marginTop: 8 }}>{coordsError}</Text> : null}
      {denied ? <Button title={t('sharedAddressEdit.openSettings')} variant="ghost" onPress={openSettings} /> : null}

      <Text variant="bodySmall" weight="medium" color={theme.colors.textSecondary} style={{ marginTop: 24, marginBottom: 8 }}>{t('sharedAddressEdit.thisIsMy')}</Text>
      <ChipChoice options={LABELS()} selectedIds={label} onChange={setLabel} />

      <View style={{ gap: 16, marginTop: 24 }}>
        <TextInput testID="street-input" label={t('sharedAddressEdit.houseStreet')} value={street} onChangeText={setStreet} autoComplete="street-address" error={streetError} />
        <TextInput label={t('sharedAddressEdit.flatFloorOrBuilding')} value={building} onChangeText={setBuilding} />
        <TextInput label={t('sharedAddressEdit.areaOrNeighbourhoodOptional')} value={area} onChangeText={setArea} />
        <TextInput testID="city-input" label={t('sharedAddressEdit.city')} value={city} onChangeText={setCity} autoCapitalize="words" error={cityError} />
        <TextInput label={t('sharedAddressEdit.landmarkToHelpFind')} placeholder={t('sharedAddressEdit.eGOppositeThe')} value={landmark} onChangeText={setLandmark} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24 }}>
        <View style={{ flex: 1, marginEnd: 12 }}>
          <Text variant="body" weight="medium" color={theme.colors.textPrimary}>{t('sharedAddressEdit.useThisAddressBy')}</Text>
          {/* You can't un-set the only default here; you pick a different address as default instead.
              Without this hint, turning the switch off and saving looks like "my change didn't save". */}
          {initial?.isDefault ? <Text variant="caption" color={theme.colors.textTertiary} style={{ marginTop: 2 }}>{t('sharedAddressEdit.alreadyDefaultHint')}</Text> : null}
        </View>
        <Switch value={isDefault} onValueChange={setIsDefault} disabled={initial?.isDefault === true} accessibilityLabel={t('sharedAddressEdit.useThisAddressBy')} trackColor={{ true: theme.colors.primary, false: theme.colors.border }} />
      </View>

      {id ? <View style={{ marginTop: 24 }}><Button title={t('sharedAddressEdit.deleteThisAddress')} variant="danger" onPress={remove} disabled={saving} /></View> : null}
    </Screen>
  );
}
