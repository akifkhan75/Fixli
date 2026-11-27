import React, { useEffect } from 'react';
import { DimensionValue, StyleProp, View, ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';

export function Skeleton({ width = '100%', height = 16, radius = 8, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduce) { opacity.value = 1; return; }
    opacity.value = withRepeat(withTiming(0.45, { duration: 750 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduce, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: theme.colors.skeleton }, animated, style]} />;
}

/** Placeholder shaped like the cards that are loading, so the screen doesn't jump when they arrive. */
export function SkeletonList({ count = 3, label }: { count?: number; label?: string }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={{ alignSelf: 'stretch', gap: 12, overflow: 'hidden' }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.lg, padding: 16, flexDirection: 'row', gap: 14 }}>
          <Skeleton width={48} height={48} radius={24} />
          <View style={{ flex: 1, gap: 10, justifyContent: 'center' }}>
            <Skeleton width="65%" />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
