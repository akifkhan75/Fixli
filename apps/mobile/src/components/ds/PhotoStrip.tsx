import React from 'react';
import { Image, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { PressableScale } from '../motion/PressableScale';
import { useI18n } from '../../hooks/useI18n';

/** A row of photos; each can be removed when `onRemove` is given. */
export function PhotoStrip({ photos, label, onRemove, size = 112 }: { photos: { id: string; uri: string }[]; label: string; onRemove?: (id: string) => void; size?: number }) {
  const theme = useTheme();
  const { t } = useI18n();
  if (!photos.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
      {photos.map((p) => (
        <View key={p.id}>
          <Image source={{ uri: p.uri }} accessibilityLabel={label} style={{ width: size, height: size, borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.surfaceElevated }} />
          {onRemove ? (
            <PressableScale onPress={() => onRemove(p.id)} accessibilityRole="button" accessibilityLabel={t('customerRequestService.removePhoto')} hitSlop={10}
              style={{ position: 'absolute', top: 4, end: 4, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.overlay }}>
              <Ionicons name="close" size={20} color={theme.colors.onPrimary} />
            </PressableScale>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
