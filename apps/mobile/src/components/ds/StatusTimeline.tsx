import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Entrance } from '../motion/Entrance';
import { ProgressBar } from '../motion/ProgressBar';
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

/** A soft halo that breathes around the step happening now. */
function Halo({ color }: { color: string }) {
  const reduce = useReduceMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withRepeat(withTiming(1, { duration: 1500 }), -1, false);
    return () => cancelAnimation(p);
  }, [reduce, p]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + p.value * 0.55 }], opacity: 0.35 * (1 - p.value) }));
  if (reduce) return null;
  return <Animated.View style={[{ position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: color }, style]} />;
}

export const StatusTimeline = ({ currentPhase }: StatusTimelineProps) => {
  const theme = useTheme();
  const phases = PHASES();
  const found = phases.findIndex((p) => p.id === currentPhase);
  // PAID comes after DONE, so everything is behind us; anything unknown starts at the beginning.
  const activeIndex = found === -1 ? (currentPhase === 'PAID' ? phases.length : 0) : found;
  const step = Math.min(activeIndex + 1, phases.length);

  return (
    <View style={{ padding: theme.spacing.lg }}>
      <ProgressBar value={step / phases.length} label={t('statusTimeline.stepOf', { step, total: phases.length })} color={activeIndex >= phases.length - 1 ? theme.colors.success : theme.colors.primary} />
      <View style={{ marginTop: theme.spacing.lg }}>
        {phases.map((phase, index) => {
          const isPast = index < activeIndex;
          const isActive = index === activeIndex;
          const last = index === phases.length - 1;
          const color = isPast ? theme.colors.success : isActive ? theme.colors.primary : theme.colors.surfaceElevated;

          return (
            <Entrance key={phase.id} index={index} style={{ flexDirection: 'row', minHeight: last ? 36 : 52 }}>
              <View style={{ width: 36, alignItems: 'center' }}>
                <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                  {isActive && !last ? <Halo color={theme.colors.primary} /> : null}
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={isPast ? 'checkmark' : phase.icon} size={17} color={isPast || isActive ? theme.colors.onPrimary : theme.colors.textTertiary} />
                  </View>
                </View>
                {!last ? <View style={{ width: 3, flex: 1, borderRadius: 2, marginVertical: 2, backgroundColor: isPast ? theme.colors.success : theme.colors.surfaceElevated }} /> : null}
              </View>
              <View style={{ flex: 1, marginStart: theme.spacing.lg, paddingTop: 6 }}>
                <Text variant="body" weight={isActive ? 'bold' : 'medium'} color={isActive || isPast ? theme.colors.textPrimary : theme.colors.textTertiary}>
                  {phase.label}
                </Text>
                {isActive ? (
                  <Text variant="bodySmall" color={theme.colors.textSecondary}>
                    {phase.id === 'DONE' ? t('statusTimeline.complete') : t('statusTimeline.inProgress')}
                  </Text>
                ) : null}
              </View>
            </Entrance>
          );
        })}
      </View>
    </View>
  );
};
