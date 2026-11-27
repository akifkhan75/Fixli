import React from 'react';
import { Text as RNText, TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { getLocale } from '../../i18n';

/**
 * Nastaliq stacks its marks tall: at a normal line height Urdu lines collide. Text in Urdu uses
 * the Noto Nastaliq Urdu face (it has four weights) at 2.1x line height; other languages keep Inter.
 * (1.7x cut off the tails of letters on Android, worst in headings.)
 */
export const URDU_LINE_HEIGHT = 2.1;
const URDU_FONT: Record<string, string> = {
  normal: 'NotoNastaliqUrdu_400Regular',
  medium: 'NotoNastaliqUrdu_500Medium',
  semibold: 'NotoNastaliqUrdu_600SemiBold',
  bold: 'NotoNastaliqUrdu_700Bold',
  extrabold: 'NotoNastaliqUrdu_700Bold',
};

export type TextVariant =
  | 'display'
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
  /** Digits of equal width, so changing prices and counters don't wobble. */
  tabular?: boolean;
}

export const Text = ({
  variant = 'body',
  color,
  align,
  weight,
  tabular,
  style,
  children,
  ...props
}: TextProps) => {
  const theme = useTheme();

  let fontSize = theme.fontSize.base;
  let defaultWeight: NonNullable<TextProps['weight']> = 'normal';

  switch (variant) {
    case 'display':
      fontSize = theme.fontSize['5xl'];
      defaultWeight = 'bold';
      tabular ??= true;
      break;
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
  // Tight tracking suits large Latin titles; in Arabic script it would break the joins.
  const tracking = getLocale() === 'en' && (variant === 'display' || variant === 'h1' || variant === 'h2') ? -0.5 : 0;
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
          letterSpacing: tracking,
          ...(tabular ? { fontVariant: ['tabular-nums' as const] } : {}),
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
