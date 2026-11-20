import React, { useState, useRef, useEffect } from 'react';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  View,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { t } from '../../i18n';

export interface TextInputProps extends RNTextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const TextInput = ({
  label,
  error,
  leftIcon,
  rightIcon,
  onFocus,
  onBlur,
  style,
  value,
  ...props
}: TextInputProps) => {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: isFocused ? 1 : 0,
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: false,
    }).start();
  }, [isFocused, reduceMotion]);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  const borderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [error ? theme.colors.error : theme.colors.border, error ? theme.colors.error : theme.colors.primary],
  });

  const backgroundColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.surfaceElevated, theme.colors.background],
  });

  return (
    <View style={styles.container}>
      {label && (
        <Text variant="bodySmall" weight="medium" style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
          {label}
        </Text>
      )}
      
      <Animated.View
        style={[
          styles.inputWrapper,
          {
            borderColor,
            backgroundColor,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1.5,
          },
        ]}
      >
        {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
        
        <RNTextInput
          style={[
            styles.input,
            {
              color: theme.colors.textPrimary,
              fontSize: theme.fontSize.base,
              paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
            },
            style,
          ]}
          onFocus={handleFocus}
          onBlur={handleBlur}
          value={value}
          placeholderTextColor={theme.colors.textTertiary}
          accessible
          accessibilityLabel={props.accessibilityLabel || label || props.placeholder}
          accessibilityHint={error ? t('textInput.error', { error }) : props.accessibilityHint}
          {...props}
        />
        
        {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
      </Animated.View>

      {error && (
        <Text variant="caption" style={{ color: theme.colors.errorText, marginTop: theme.spacing.xs }}>
          {error}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
  },
  iconLeft: {
    paddingLeft: 16,
  },
  iconRight: {
    paddingRight: 16,
  },
});
