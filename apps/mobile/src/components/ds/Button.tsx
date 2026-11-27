import React from 'react';
import { ActivityIndicator, GestureResponderEvent, PressableProps, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { PressableScale } from '../motion/PressableScale';
import { Text } from './Text';

/** `accent` is the orange highlight: at most one per screen (docs/22). */
export type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'accent' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  title: string;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  title,
  loading = false,
  disabled,
  onPress,
  style,
  leftIcon,
  rightIcon,
  ...props
}: ButtonProps) => {
  const theme = useTheme();
  const c = theme.colors;
  const inactive = !!disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    secondary: { bg: c.surfaceElevated, fg: c.textPrimary },
    tinted: { bg: c.primarySoft, fg: c.primaryText },
    accent: { bg: c.accent, fg: c.onAccent },
    outline: { bg: 'transparent', fg: c.textPrimary, border: c.borderLight },
    ghost: { bg: 'transparent', fg: c.primaryText },
    danger: { bg: c.error, fg: c.onPrimary },
  };
  const { bg, fg, border } = palette[variant];
  // Loading keeps the button's colour; only a truly unavailable one is greyed out.
  const greyed = !!disabled && !loading;

  // Touch targets: at least 48 pt, 56 pt for the big primary buttons (doc 27 F7.5).
  const sizing = {
    sm: { minHeight: 48, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, text: 'bodySmall' as const },
    md: { minHeight: 52, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xl, text: 'body' as const },
    lg: { minHeight: 56, paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing['2xl'], text: 'bodyLarge' as const },
  }[size];

  const container: ViewStyle = {
    backgroundColor: greyed ? c.surfaceElevated : bg,
    borderColor: greyed ? 'transparent' : border ?? 'transparent',
    borderWidth: variant === 'outline' ? 1.5 : 0,
    borderRadius: theme.borderRadius.lg,
    minHeight: sizing.minHeight,
    paddingVertical: sizing.paddingVertical,
    paddingHorizontal: sizing.paddingHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  };

  return (
    <PressableScale
      haptics={variant === 'primary' || variant === 'accent' || variant === 'danger' ? 'medium' : 'light'}
      accessible
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      {...props}
      style={[container, style]}
      disabled={inactive}
      onPress={(e: GestureResponderEvent) => { if (!inactive) onPress?.(e); }}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {leftIcon}
          <Text variant={sizing.text} weight="semibold" align="center" style={{ color: greyed ? c.textTertiary : fg, flexShrink: 1 }}>
            {title}
          </Text>
          {rightIcon}
        </>
      )}
    </PressableScale>
  );
};
