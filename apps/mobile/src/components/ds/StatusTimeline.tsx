import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';

export type JobPhase = 
  | 'REQUESTED' 
  | 'OFFERS_READY' 
  | 'BOOKED' 
  | 'ON_THE_WAY' 
  | 'ARRIVED' 
  | 'WORKING' 
  | 'DONE' 
  | 'PAID';

export interface StatusTimelineProps {
  currentPhase: JobPhase;
}

const PHASES = (): { id: JobPhase; label: string; icon: keyof typeof Ionicons.glyphMap }[] => ([
  { id: 'REQUESTED', label: t('statusTimeline.requested'), icon: 'paper-plane' },
  { id: 'OFFERS_READY', label: t('statusTimeline.offersReady'), icon: 'people' },
  { id: 'BOOKED', label: t('statusTimeline.booked'), icon: 'calendar' },
  { id: 'ON_THE_WAY', label: t('customerJob.onTheWay'), icon: 'car' },
  { id: 'ARRIVED', label: t('statusTimeline.arrived'), icon: 'location' },
  { id: 'WORKING', label: t('statusTimeline.working'), icon: 'hammer' },
  { id: 'DONE', label: t('sharedChangePassword.done'), icon: 'checkmark-circle' },
]);

export const StatusTimeline = ({ currentPhase }: StatusTimelineProps) => {
  const theme = useTheme();
  
  const currentIndex = PHASES().findIndex((p) => p.id === currentPhase);
  // Default to first phase if invalid or PAID (PAID implies DONE is complete)
  const activeIndex = currentIndex === -1 ? (currentPhase === 'PAID' ? PHASES().length : 0) : currentIndex;

  return (
    <View style={styles.container}>
      {PHASES().map((phase, index) => {
        const isPast = index < activeIndex;
        const isActive = index === activeIndex;
        const isFuture = index > activeIndex;

        const color = isPast 
          ? theme.colors.success 
          : isActive 
            ? theme.colors.primary 
            : theme.colors.border;

        return (
          <View key={phase.id} style={styles.row}>
            {/* Icon + Line column */}
            <View style={styles.iconColumn}>
              <View style={[styles.iconCircle, { backgroundColor: color }]}>
                <Ionicons name={phase.icon} size={16} color="#FFF" />
              </View>
              {index < PHASES().length - 1 && (
                <View style={[styles.line, { backgroundColor: isPast ? theme.colors.success : theme.colors.border }]} />
              )}
            </View>

            {/* Text column */}
            <View style={styles.textColumn}>
              <Text 
                variant="body" 
                weight={isActive ? 'bold' : 'medium'}
                color={isActive ? theme.colors.textPrimary : theme.colors.textTertiary}
              >
                {phase.label}
              </Text>
              {isActive && (
                <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 2 }}>
                  {t('statusTimeline.inProgress')}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    minHeight: 56,
  },
  iconColumn: {
    width: 32,
    alignItems: 'center',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    width: 2,
    flex: 1,
    marginVertical: 4,
  },
  textColumn: {
    flex: 1,
    marginLeft: 16,
    paddingTop: 6,
  },
});
