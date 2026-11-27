import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { motion } from '../../theme';
import { useTheme } from '../../hooks/useTheme';

/** `value` is 0..1. Fills from the reading-start edge, so it is correct in Urdu and Arabic too. */
export function ProgressBar({ value, height = 8, color, label }: { value: number; height?: number; color?: string; label?: string }) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(clamped, { ...motion.spring, overshootClamping: true, reduceMotion: ReduceMotion.System });
  }, [clamped, progress]);
  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ height, borderRadius: height / 2, backgroundColor: theme.colors.surfaceElevated, overflow: 'hidden' }}
    >
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color ?? theme.colors.primary }, fill]} />
    </View>
  );
}
