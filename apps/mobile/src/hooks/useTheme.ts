import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { getTheme, ThemeMode } from '../theme';
import type { RootState } from '../store';

export function useTheme() {
  const systemScheme = useColorScheme();
  const appearance = useSelector((s: RootState) => s.ui.appearance);

  // "system" follows the phone; an explicit choice wins. Unknown schemes get light, the primary design.
  const currentMode: ThemeMode =
    appearance === 'light' || appearance === 'dark' ? appearance : systemScheme === 'dark' ? 'dark' : 'light';

  return useMemo(() => ({ ...getTheme(currentMode), mode: currentMode }), [currentMode]);
}
