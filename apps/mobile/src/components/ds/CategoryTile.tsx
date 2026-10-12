import React from 'react';
import { TouchableOpacity, View, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';

export interface CategoryTileProps {
  id: string;
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

const { width } = Dimensions.get('window');
// Calculate 2 columns with spacing (20 padding on each side of screen, 16 gap between tiles)
const TILE_WIDTH = (width - 40 - 16) / 2;

export const CategoryTile = ({ name, icon = 'construct', onPress }: CategoryTileProps) => {
  const theme = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surfaceElevated,
          width: TILE_WIDTH,
          borderRadius: theme.borderRadius['2xl'],
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('categoryTile.serviceCategory', { name })}
    >
      <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15' }]}>
        <Ionicons name={icon} size={32} color={theme.colors.primary} />
      </View>
      <Text variant="bodyLarge" weight="semibold" style={{ marginTop: theme.spacing.md }}>
        {name}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 120,
    padding: 16,
    justifyContent: 'center',
    shadowColor: 'rgba(10,18,40,0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 2,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
