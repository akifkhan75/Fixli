import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { PressableScale } from '../motion/PressableScale';

interface CardProps {
  onPress?: () => void;
  /** Outline in a status colour to draw the eye. */
  highlight?: string;
  /** Background wash for status cards; defaults to the surface colour. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

/** A raised block of related content. Tappable when given `onPress`. */
export function Card({ onPress, highlight, tint, style, accessibilityLabel, children }: CardProps) {
  const theme = useTheme();
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: tint ?? theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      borderWidth: highlight ? 1.5 : 0,
      borderColor: highlight,
      padding: theme.spacing.lg,
    },
    theme.mode === 'light' ? theme.shadows.sm : null,
    style,
  ];
  return onPress
    ? <PressableScale onPress={onPress} accessibilityLabel={accessibilityLabel} style={base}>{children}</PressableScale>
    : <View style={base}>{children}</View>;
}
