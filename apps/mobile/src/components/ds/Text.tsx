import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { getLocale } from '../../i18n';

/**
 * Nastaliq stacks its marks tall: at a normal line height Urdu lines collide. Text in Urdu uses
 * the Noto Nastaliq Urdu face (it has four weights) at 1.7x line height; other languages keep Inter.
 */
export const URDU_LINE_HEIGHT = 1.7;
const URDU_FONT: Record<string, string> = {
  normal: 'NotoNastaliqUrdu_400Regular',
  medium: 'NotoNastaliqUrdu_500Medium',
  semibold: 'NotoNastaliqUrdu_600SemiBold',
  bold: 'NotoNastaliqUrdu_700Bold',
  extrabold: 'NotoNastaliqUrdu_700Bold',
};

export type TextVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bodyLarge'
  | 'body'
  | 'bodySmall'
  | 'caption';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string; // Optional hex or theme key (handled internally)
  /** Leave unset to follow the reading direction (right edge in Urdu/Arabic). */
  align?: 'left' | 'center' | 'right' | 'justify';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';
}

export const Text = ({
  variant = 'body',
  color,
  align,
  weight,
  style,
  children,
  ...props
}: TextProps) => {
  const theme = useTheme();

  let fontSize = theme.fontSize.base;
  let defaultWeight: NonNullable<TextProps['weight']> = 'normal';

  switch (variant) {
    case 'h1':
      fontSize = theme.fontSize['4xl'];
      defaultWeight = 'bold';
      break;
    case 'h2':
      fontSize = theme.fontSize['3xl'];
      defaultWeight = 'bold';
      break;
    case 'h3':
      fontSize = theme.fontSize.xl;
      defaultWeight = 'semibold';
      break;
    case 'bodyLarge':
      fontSize = theme.fontSize.lg;
      break;
    case 'body':
      fontSize = theme.fontSize.base;
      break;
    case 'bodySmall':
      fontSize = theme.fontSize.sm;
      break;
    case 'caption':
      fontSize = theme.fontSize.xs;
      break;
  }

  const activeWeight = weight || defaultWeight;
  const textColor = color || theme.colors.textPrimary;

  // Map font weight to Inter font family
  let fontFamily = 'Inter_400Regular';
  switch (activeWeight) {
    case 'medium':
      fontFamily = 'Inter_500Medium';
      break;
    case 'semibold':
      fontFamily = 'Inter_600SemiBold';
      break;
    case 'bold':
      fontFamily = 'Inter_700Bold';
      break;
    case 'extrabold':
      fontFamily = 'Inter_800ExtraBold';
      break;
  }

  const urdu = getLocale() === 'ur';
  if (urdu) fontFamily = URDU_FONT[activeWeight] ?? URDU_FONT.normal;

  return (
    <RNText
      style={[
        {
          fontSize,
          color: textColor,
          // 'auto' follows the text's own direction, so Urdu/Arabic align right without every screen asking.
          textAlign: align ?? 'auto',
          fontFamily,
          ...(urdu ? { lineHeight: Math.round(fontSize * URDU_LINE_HEIGHT) } : {}),
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
};
