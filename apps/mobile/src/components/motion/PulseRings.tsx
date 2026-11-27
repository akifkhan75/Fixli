import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';

const PERIOD = 2200;

function Ring({ size, delay, color }: { size: number; delay: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: PERIOD, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(t);
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 0.4 + t.value * 0.6 }], opacity: 0.5 * (1 - t.value) }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** "We are looking": rings spread from an icon while workers are being found. */
export function PulseRings({ icon = 'search', size = 144, label }: { icon?: keyof typeof Ionicons.glyphMap; size?: number; label?: string }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const core = size * 0.4;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {reduce ? null : [0, 1, 2].map((i) => <Ring key={i} size={size} delay={(PERIOD / 3) * i} color={theme.colors.primaryLight} />)}
      <View style={{ width: core, height: core, borderRadius: core / 2, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={core * 0.5} color={theme.colors.onPrimary} />
      </View>
    </View>
  );
}
