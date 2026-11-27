import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { ZoomIn, ReduceMotion } from 'react-native-reanimated';
import type { Theme } from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Shared bottom-tab look. `bottomInset` is the phone's home-indicator area, never a guessed number. */
export function tabScreenOptions(theme: Theme, bottomInset: number) {
  return {
    headerShown: false,
    tabBarStyle: {
      backgroundColor: theme.colors.tabBar,
      borderTopColor: theme.colors.border,
      borderTopWidth: 1,
      height: 68 + bottomInset,
      paddingBottom: bottomInset + 6,
      paddingTop: 6,
    },
    tabBarActiveTintColor: theme.colors.primaryText,
    tabBarInactiveTintColor: theme.colors.textTertiary,
    tabBarLabelStyle: { fontSize: 12, fontWeight: '600' as const },
  };
}

/** Outline when resting, filled on a soft pill when selected: readable without reading the label. */
export function tabIcon(active: IconName, inactive: IconName, theme: Theme) {
  return function TabIcon({ color, focused }: { color: React.ComponentProps<typeof Ionicons>['color']; focused: boolean }) {
    return (
      <View style={{ width: 56, height: 30, alignItems: 'center', justifyContent: 'center' }}>
        {focused ? (
          <Animated.View
            entering={ZoomIn.duration(theme.motion.duration.base).reduceMotion(ReduceMotion.System)}
            style={{ position: 'absolute', width: 56, height: 30, borderRadius: 15, backgroundColor: theme.colors.primarySoft }}
          />
        ) : null}
        <Ionicons name={focused ? active : inactive} size={22} color={color} />
      </View>
    );
  };
}
