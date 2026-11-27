import React, { useEffect } from 'react';
import Animated, { ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { motion } from '../../theme';
import { useTheme } from '../../hooks/useTheme';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const TICK_LENGTH = 48;

/** The "it worked" moment: a circle pops in, the tick draws itself, the phone gives a success buzz. */
export function SuccessCheck({ size = 96, label }: { size?: number; label?: string }) {
  const theme = useTheme();
  const scale = useSharedValue(0.4);
  const draw = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, { ...motion.spring, damping: 12, reduceMotion: ReduceMotion.System });
    draw.value = withDelay(180, withTiming(1, { duration: motion.duration.slow, reduceMotion: ReduceMotion.System }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)?.catch(() => undefined);
  }, [scale, draw]);

  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - draw.value) }));

  return (
    <Animated.View style={pop} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Circle cx={32} cy={32} r={30} fill={theme.colors.success} />
        <AnimatedPath d="M19 33 L28 42 L46 23" stroke={theme.colors.onPrimary} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={TICK_LENGTH} animatedProps={tick} />
      </Svg>
    </Animated.View>
  );
}
