import React from 'react';
import { ImageStyle, StyleProp } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../hooks/useTheme';
import { t } from '../../i18n';

// logo-light = dark wordmark for light backgrounds, logo-dark = white wordmark for dark backgrounds
const SOURCES = {
  light: require('../../../assets/images/logo-light.png'),
  dark: require('../../../assets/images/logo-dark.png'),
  mark: require('../../../assets/images/logo-mark.png'),
};

const ASPECT = { wordmark: 838 / 317, mark: 241 / 253 };

export interface LogoProps {
  variant?: 'wordmark' | 'mark';
  height?: number;
  style?: StyleProp<ImageStyle>;
}

export const Logo = ({ variant = 'wordmark', height = 48, style }: LogoProps) => {
  const theme = useTheme();
  const source = variant === 'mark' ? SOURCES.mark : SOURCES[theme.mode];

  return (
    <Image
      source={source}
      style={[{ height, width: height * ASPECT[variant] }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel={t('logo.fixli')}
    />
  );
};
