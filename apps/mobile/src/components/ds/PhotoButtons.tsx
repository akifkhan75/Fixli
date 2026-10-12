import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Button } from './Button';
import { Text } from './Text';
import { openSettings } from '../../services/pickPhoto';
import { t } from '../../i18n';

/** "Take a photo" / "Choose from gallery" with the permission-denied explanation built in. */
export function PhotoButtons({ onPick, busy, error, denied, takeLabel = 'Take a photo', chooseLabel = 'Choose from gallery' }: {
  onPick: (source: 'camera' | 'library') => void;
  busy?: boolean;
  error?: string;
  denied?: boolean;
  takeLabel?: string;
  chooseLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Button title={takeLabel} variant="primary" size="lg" loading={busy} disabled={busy} onPress={() => onPick('camera')} leftIcon={<Ionicons name="camera" size={22} color="#FFF" />} />
      <Button title={chooseLabel} variant="secondary" size="lg" disabled={busy} onPress={() => onPick('library')} leftIcon={<Ionicons name="images" size={22} color={theme.colors.textPrimary} />} />
      {error ? <Text variant="bodySmall" color={theme.colors.errorText} accessibilityRole="alert">{error}</Text> : null}
      {denied ? <Button title={t('sharedAddressEdit.openSettings')} variant="ghost" onPress={openSettings} /> : null}
    </View>
  );
}
