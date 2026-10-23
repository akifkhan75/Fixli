import React from 'react';
import { I18nManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = React.ComponentProps<typeof Ionicons>;

/** Arrows and chevrons point the other way in Urdu and Arabic. Use this instead of Ionicons for them. */
export function DirIcon({ style, ...props }: Props) {
  return <Ionicons {...props} style={[style, I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : null]} />;
}
