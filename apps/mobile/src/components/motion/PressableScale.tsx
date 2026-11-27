import React from 'react';
import { GestureResponderEvent, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { motion } from '../../theme';
import { useReduceMotion } from '../../hooks/useReduceMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type HapticKind = 'none' | 'selection' | 'light' | 'medium';

export function haptic(kind: HapticKind) {
  if (kind === 'none') return;
  const run = kind === 'selection'
    ? Haptics.selectionAsync()
    : Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  // Phones without a vibration motor reject; feedback is never worth an error.
  run?.catch(() => undefined);
}

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  haptics?: HapticKind;
  /** Pressed size; 1 turns the effect off. */
  scaleTo?: number;
}

/** The app's tappable surface: springs down under the finger and clicks. Still under "Reduce motion". */
export function PressableScale({ style, haptics = 'selection', scaleTo = motion.pressScale, onPress, onPressIn, onPressOut, disabled, children, ...props }: PressableScaleProps) {
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...props}
      disabled={disabled}
      onPress={onPress ? (e: GestureResponderEvent) => { haptic(haptics); onPress(e); } : undefined}
      onPressIn={(e) => { if (!reduce) scale.value = withSpring(scaleTo, motion.spring); onPressIn?.(e); }}
      onPressOut={(e) => { if (!reduce) scale.value = withSpring(1, motion.spring); onPressOut?.(e); }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
