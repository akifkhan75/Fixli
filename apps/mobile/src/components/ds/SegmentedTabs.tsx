import React from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { PressableScale } from '../motion/PressableScale';
import { Text } from './Text';

interface Tab<T extends string> {
  id: T;
  label: string;
  /** Shown as a small bubble, e.g. new requests waiting. */
  count?: number;
}

export function SegmentedTabs<T extends string>({ tabs, value, onChange }: { tabs: Tab<T>[]; value: T; onChange: (id: T) => void }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.borderRadius.lg, padding: 4, marginBottom: theme.spacing.xl }}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <PressableScale
            key={tab.id}
            onPress={() => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.count ? `${tab.label}, ${tab.count}` : tab.label}
            style={{ flex: 1, minHeight: 48, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}
          >
            {selected ? (
              <Animated.View
                entering={FadeIn.duration(theme.motion.duration.fast).reduceMotion(ReduceMotion.System)}
                style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.surface }, theme.shadows.sm]}
              />
            ) : null}
            <Text variant="bodySmall" weight="bold" numberOfLines={1} color={selected ? theme.colors.textPrimary : theme.colors.textSecondary} style={{ flexShrink: 1 }}>{tab.label}</Text>
            {tab.count ? (
              <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight="bold" color={theme.colors.onPrimary} style={{ fontSize: 12 }}>{tab.count}</Text>
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}
