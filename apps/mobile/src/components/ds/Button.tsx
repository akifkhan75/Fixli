import React from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends TouchableOpacityProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  title: string;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
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

  const handlePress = (e: any) => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(e);
  };

  // Determine colors based on variant
  let backgroundColor: string = theme.colors.primary;
  let textColor: string = '#FFF';
  let borderColor: string = 'transparent';

  switch (variant) {
    case 'primary':
      backgroundColor = theme.colors.primary;
      textColor = '#FFF';
      break;
    case 'secondary':
      backgroundColor = theme.colors.surfaceElevated;
      textColor = theme.colors.textPrimary;
      break;
    case 'outline':
      backgroundColor = 'transparent';
      borderColor = theme.colors.border;
      textColor = theme.colors.textPrimary;
      break;
    case 'ghost':
      backgroundColor = 'transparent';
      textColor = theme.colors.primaryText;
      break;
    case 'danger':
      backgroundColor = theme.colors.error;
      textColor = '#FFF';
      break;
  }

  // Determine sizing
  let paddingVertical = theme.spacing.md;
  let paddingHorizontal = theme.spacing.xl;
  let textVariant: 'bodySmall' | 'body' | 'bodyLarge' = 'body';
  // Touch targets: at least 48 pt, 56 pt for the big primary buttons (doc 27 F7.5).
  let minHeight = 52;

  if (size === 'sm') {
    paddingVertical = theme.spacing.sm;
    paddingHorizontal = theme.spacing.lg;
    textVariant = 'bodySmall';
    minHeight = 48;
  } else if (size === 'lg') {
    paddingVertical = theme.spacing.lg;
    paddingHorizontal = theme.spacing['2xl'];
    textVariant = 'bodyLarge';
    minHeight = 56;
  }

  const containerStyle: ViewStyle = {
    backgroundColor: disabled ? theme.colors.surfaceElevated : backgroundColor,
    borderColor: disabled ? 'transparent' : borderColor,
    borderWidth: variant === 'outline' ? 1.5 : 0,
    borderRadius: theme.borderRadius.lg,
    minHeight,
    paddingVertical,
    paddingHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.6 : 1,
    gap: theme.spacing.sm,
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[containerStyle, style]}
      onPress={handlePress}
      disabled={disabled || loading}
      accessible
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {leftIcon}
          <Text variant={textVariant} weight="semibold" style={{ color: textColor }}>
            {title}
          </Text>
          {rightIcon}
        </>
      )}
    </TouchableOpacity>
  );
};
