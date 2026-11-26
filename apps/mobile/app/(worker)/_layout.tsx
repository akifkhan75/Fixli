import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';

/** Tabs live in (tabs); job detail is a sibling Stack screen so it never bounces to Today. */
export default function WorkerLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
