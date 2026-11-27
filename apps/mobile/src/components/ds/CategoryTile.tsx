import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { PressableScale } from '../motion/PressableScale';
import { categoryTint } from '../../utils/categoryTint';
import { Text } from './Text';
import { useI18n } from '../../hooks/useI18n';

export interface CategoryTileProps {
  /** Stable catalog key such as PLUMBING; picks the tile's colour. */
  code?: string;
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A big picture button: the colour and icon identify the trade before any word is read. */
export const CategoryTile = ({ code, name, icon = 'construct', onPress, selected, style }: CategoryTileProps) => {
  const theme = useTheme();
  const { t } = useI18n();
  const tint = categoryTint(code, theme.categoryColors);

  return (
    <PressableScale
      style={[
        {
          minHeight: 118,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.borderRadius.xl,
          borderWidth: 2,
          borderColor: selected ? theme.colors.primary : 'transparent',
        },
        theme.mode === 'light' ? theme.shadows.sm : null,
        style,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={t('categoryTile.serviceCategory', { name })}
    >
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={30} color={tint} />
      </View>
      <Text variant="bodySmall" weight="semibold" align="center" numberOfLines={2} style={{ marginTop: theme.spacing.sm }}>
        {name}
      </Text>
    </PressableScale>
  );
};
