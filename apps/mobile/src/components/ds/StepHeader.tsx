import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Text } from './Text';
import { SpeakButton } from './SpeakButton';

/** The question a screen asks, in a few plain words, with a button that says it aloud. */
export function StepHeader({ question, help }: { question: string; help?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: theme.spacing.xl }}>
      <View style={{ flex: 1 }}>
        <Text variant="h2" weight="bold" accessibilityRole="header">{question}</Text>
        {help ? <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>{help}</Text> : null}
      </View>
      <SpeakButton text={help ? `${question}. ${help}` : question} />
    </View>
  );
}
