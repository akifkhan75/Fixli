import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { PressableScale } from '../motion/PressableScale';
import { Text } from './Text';
import { SpeakButton } from './SpeakButton';

interface ChoiceCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One plain example of what this choice means. */
  hint?: string;
  selected?: boolean;
  onPress: () => void;
  /** Adds a "read aloud" button for this choice. */
  speak?: boolean;
}

/** One big, picture-first answer. Used wherever a person picks one of a few things. */
export function ChoiceCard({ icon, title, hint, selected, onPress, speak }: ChoiceCardProps) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.spacing.md }}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected: !!selected }}
        accessibilityLabel={hint ? `${title}. ${hint}` : title}
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 80, padding: theme.spacing.md,
          borderRadius: theme.borderRadius.xl, borderWidth: 2,
          borderColor: selected ? theme.colors.primary : 'transparent',
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
        }}
      >
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated }}>
          <Ionicons name={icon} size={28} color={selected ? theme.colors.onPrimary : theme.colors.primaryText} />
        </View>
        <View style={{ flex: 1, marginStart: theme.spacing.md }}>
          <Text variant="bodyLarge" weight="bold">{title}</Text>
          {hint ? <Text variant="bodySmall" color={theme.colors.textSecondary}>{hint}</Text> : null}
        </View>
        {selected ? <Ionicons name="checkmark-circle" size={26} color={theme.colors.primaryText} /> : null}
      </PressableScale>
      {speak ? <SpeakButton text={hint ? `${title}. ${hint}` : title} /> : null}
    </View>
  );
}
