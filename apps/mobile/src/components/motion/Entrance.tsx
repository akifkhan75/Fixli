import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { motion } from '../../theme';

interface EntranceProps {
  /** Position in a list: each item follows the one before it. */
  index?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** Content rises and fades in once. Reanimated skips it when "Reduce motion" is on. */
export function Entrance({ index = 0, delay = 0, style, children }: EntranceProps) {
  const entering = FadeInDown
    .delay(delay + Math.min(index, motion.maxStaggerItems) * motion.stagger)
    .duration(motion.duration.base)
    .reduceMotion(ReduceMotion.System);
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
}
