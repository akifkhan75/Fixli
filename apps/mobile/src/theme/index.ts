// ============================================================
// Fixli Design System: theme tokens (docs/22 §7.2)
// Light-first and calm; dark mode is an equal peer.
// Every text/background pair is checked by src/__tests__/theme.test.ts.
// ============================================================

export const colors = {
  // ── Light Mode (primary design target) ───────────────────
  light: {
    background: '#F2F2F7',
    surface: '#FFFFFF',
    /** Inset fills: inputs, secondary buttons, tiles that sit on a card. */
    surfaceElevated: '#E9EBF2',
    surfaceGlass: 'rgba(255, 255, 255, 0.92)',
    // docs/22 asks for #007BFF, but white text on it is only 3.98:1. This passes 4.5:1.
    primary: '#0062CC',
    primaryPressed: '#0052AD',
    primaryText: '#0059BD',
    primaryLight: '#007BFF',
    primarySoft: '#E3EFFD',
    secondary: '#0A1228',
    secondaryLight: '#DCEBFC',
    /** Orange: at most one highlight per screen, never a large fill. */
    accent: '#FF9500',
    accentLight: '#FFC266',
    accentSoft: '#FFF2E0',
    onAccent: '#0A1228',
    success: '#0F7A41',
    successText: '#0B6B38',
    successLight: '#6EE7B7',
    successSoft: '#E1F4E9',
    error: '#C62B22',
    errorText: '#B3261E',
    errorLight: '#FCA5A5',
    errorSoft: '#FCE8E6',
    warning: '#9A5B00',
    warningText: '#8A5000',
    warningSoft: '#FFF0D6',
    sos: '#D32F2F',
    onPrimary: '#FFFFFF',
    textPrimary: '#0A1228',
    textSecondary: '#46526C',
    textTertiary: '#586480',
    textInverse: '#F5F7FB',
    border: 'rgba(60, 60, 67, 0.14)',
    borderLight: 'rgba(60, 60, 67, 0.24)',
    overlay: 'rgba(10, 18, 40, 0.45)',
    shadow: 'rgba(10, 18, 40, 0.12)',
    skeleton: '#E4E6EE',
    skeletonShine: '#F7F8FB',
    cardGradientStart: '#FFFFFF',
    cardGradientEnd: '#F2F2F7',
    tabBar: '#FFFFFF',
    statusBar: '#F2F2F7',
  },

  // ── Dark Mode ────────────────────────────────────────────
  dark: {
    background: '#0A1228',
    surface: '#121B33',
    surfaceElevated: '#1E2A4A',
    surfaceGlass: 'rgba(18, 27, 51, 0.92)',
    primary: '#0069E0',
    primaryPressed: '#005BC4',
    primaryText: '#5CABFF',
    primaryLight: '#2E94FF',
    primarySoft: '#132D55',
    secondary: '#F5F7FB',
    secondaryLight: '#1D3A66',
    accent: '#FFAA33',
    accentLight: '#FFC266',
    accentSoft: '#3A2B14',
    onAccent: '#0A1228',
    success: '#0F7A41',
    successText: '#4ADE9A',
    successLight: '#34D399',
    successSoft: '#10332A',
    error: '#C62B22',
    errorText: '#FF9A93',
    errorLight: '#F87171',
    errorSoft: '#3B1B22',
    warning: '#9A5B00',
    warningText: '#FFB547',
    warningSoft: '#38290F',
    sos: '#D32F2F',
    onPrimary: '#FFFFFF',
    textPrimary: '#F5F7FB',
    textSecondary: '#B4BDD3',
    textTertiary: '#9AA5BF',
    textInverse: '#0A1228',
    border: 'rgba(255, 255, 255, 0.10)',
    borderLight: 'rgba(255, 255, 255, 0.18)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    shadow: 'rgba(0, 0, 0, 0.4)',
    skeleton: '#1A2440',
    skeletonShine: '#27355C',
    cardGradientStart: '#121B33',
    cardGradientEnd: '#0A1228',
    tabBar: '#121B33',
    statusBar: '#0A1228',
  },

  // ── Category tints (icon colour on a soft wash of itself) ─
  category: {
    plumbing: '#1473E6',
    electrical: '#D97E00',
    salon: '#D6337F',
    carServices: '#56647A',
    carpentry: '#B45F06',
    painting: '#0891B2',
    cleaning: '#16A34A',
    hvac: '#0D9488',
    generalHandyman: '#64748B',
    mechanics: '#DC4C41',
    construction: '#C2570C',
    renovation: '#7C5CD6',
    masonry: '#A8503A',
    welding: '#4F63C6',
    flooring: '#8A6D3B',
    roofing: '#B4456B',
    solar: '#C78A00',
    interior: '#9D4EDD',
    gardening: '#3F8F2E',
    moving: '#2F7DA8',
    security: '#3B6FB6',
    other: '#1473E6',
  },

  // ── Gradients: hero and "now" accents only ───────────────
  gradients: {
    primary: ['#0062CC', '#1473E6'] as const,
    hero: ['#0A1228', '#123A7A'] as const,
    accent: ['#FF9500', '#FFB347'] as const,
    success: ['#0F7A41', '#16A34A'] as const,
  },
};

/** 4-pt grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
};

/** Body copy is 17 (docs/22): the audience includes people who read with difficulty. */
export const fontSize = {
  xs: 13,
  sm: 15,
  base: 17,
  lg: 18,
  xl: 20,
  '2xl': 22,
  '3xl': 28,
  '4xl': 34,
  '5xl': 44,
};

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

/** Cards stay nearly flat (contrast does the work); only floating things cast a real shadow. */
export const shadows = {
  sm: {
    shadowColor: '#0A1228',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: '#0A1228',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0A1228',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
};

export const motion = {
  duration: { fast: 140, base: 240, slow: 420 },
  spring: { damping: 20, stiffness: 280, mass: 0.8 },
  pressScale: 0.97,
  /** Delay between list items entering; capped so long lists don't crawl. */
  stagger: 45,
  maxStaggerItems: 8,
};

export type ThemeMode = 'dark' | 'light';
export type ThemeColors = typeof colors.light;

export const getTheme = (mode: ThemeMode) => ({
  colors: colors[mode] as ThemeColors,
  spacing,
  borderRadius,
  fontSize,
  fontWeight,
  shadows,
  motion,
  gradients: colors.gradients,
  categoryColors: colors.category,
});

export type Theme = ReturnType<typeof getTheme>;
