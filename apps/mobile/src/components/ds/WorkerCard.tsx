import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { t, tn } from '../../i18n';

export interface WorkerCardProps {
  name: string;
  photoUrl?: string;
  rating: number;
  jobsDone: number;
  isVerified: boolean;
  price?: number; // minor units
  distance?: string; // "1.2 km away"
  onPress?: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

export const WorkerCard = ({
  name,
  photoUrl,
  rating,
  jobsDone,
  isVerified,
  price,
  distance,
  onPress,
  primaryActionLabel,
  onPrimaryAction,
}: WorkerCardProps) => {
  const theme = useTheme();

  return (
    <TouchableOpacity
      accessibilityRole={onPress ? 'button' : 'summary'}
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      style={[
        styles.container,
        { backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.xl },
      ]}
    >
      <View style={styles.topRow}>
        <Avatar name={name} imageUrl={photoUrl} size="lg" />
        
        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text variant="h3" weight="bold" color={theme.colors.textPrimary}>
              {name}
            </Text>
            {isVerified && (
              <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} style={{ marginLeft: 4 }} />
            )}
          </View>
          
          <View style={styles.statsRow}>
            <Ionicons name="star" size={14} color={theme.colors.accent} />
            <Text variant="bodySmall" weight="bold" color={theme.colors.textPrimary} style={{ marginLeft: 4 }}>
              {rating.toFixed(1)}
            </Text>
            <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginLeft: 4 }}>
              ({tn('common.jobs', jobsDone)})
            </Text>
            {distance && (
              <>
                <Text variant="bodySmall" color={theme.colors.textTertiary} style={{ marginHorizontal: 4 }}>•</Text>
                <Text variant="bodySmall" color={theme.colors.textSecondary}>{distance}</Text>
              </>
            )}
          </View>
        </View>

        {price !== undefined && (
          <View style={styles.priceCol}>
            <Text variant="h2" weight="extrabold" color={theme.colors.textPrimary}>
              ${(price / 100).toFixed(0)}
            </Text>
          </View>
        )}
      </View>

      {primaryActionLabel && onPrimaryAction && (
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          onPress={onPrimaryAction}
          style={[styles.primaryButton, { backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.full }]}
        >
          <Text variant="body" weight="bold" color={theme.colors.onPrimary}>
            {primaryActionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    marginBottom: 16,
    shadowColor: 'rgba(10,18,40,0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoCol: {
    flex: 1,
    marginLeft: 16,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
