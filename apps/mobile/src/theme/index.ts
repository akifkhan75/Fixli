// ============================================================
// Fixli Premium Design System — Theme Tokens
// Dark-first design with glassmorphism and gradient accents
// ============================================================

export const colors = {
  // ── Dark Mode ────────────────────────────────────────────
  dark: {
    background: '#0A1228',
    surface: '#1E293B',
    surfaceElevated: '#334155',
    surfaceGlass: 'rgba(30, 41, 59, 0.85)',
    primary: '#0069E0', // fills (white text on it passes 4.5:1)
    primaryText: '#38BDF8', // blue used AS text on dark surfaces
    primaryLight: '#00B4FF',
    secondary: '#00B4FF',
    secondaryLight: '#38BDF8',
    accent: '#FF9900',
    accentLight: '#FFC107',
    success: '#047857',
    successText: '#34D399',
    successLight: '#34D399',
    error: '#DC2626',
    errorText: '#FF8A8A',
    errorLight: '#F87171',
    warning: '#B45309',
    warningText: '#F59E0B',
    sos: '#D32F2F',
    onPrimary: '#FFFFFF',
    textPrimary: '#F1F5F9',
    textSecondary: '#A3B1C6',
    textTertiary: '#94A3B8',
    textInverse: '#0F172A',
    border: 'rgba(255, 255, 255, 0.08)',
    borderLight: 'rgba(255, 255, 255, 0.15)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    shadow: 'rgba(0, 0, 0, 0.3)',
    cardGradientStart: '#1E293B',
    cardGradientEnd: '#0A1228',
    tabBar: '#1E293B',
    statusBar: '#0A1228',
  },

  // ── Light Mode ───────────────────────────────────────────
  light: {
    background: '#F1F5F9',
    surface: '#FFFFFF',
    surfaceElevated: '#F8FAFC',
    surfaceGlass: 'rgba(255, 255, 255, 0.85)',
    primary: '#0066DB', // fills and text (4.5:1 against white and the light backgrounds)
    primaryText: '#0066DB',
    primaryLight: '#00B4FF',
    secondary: '#00B4FF',
    secondaryLight: '#7DD3FC',
    accent: '#FF9900',
    accentLight: '#FFC107',
    success: '#047857',
    successText: '#047857',
    successLight: '#6EE7B7',
    error: '#C81E1E',
    errorText: '#C81E1E',
    errorLight: '#FCA5A5',
    warning: '#B45309',
    warningText: '#B45309',
    sos: '#DC2626',
    onPrimary: '#FFFFFF',
    textPrimary: '#0F172A',
    textSecondary: '#516178',
    textTertiary: '#5F6F86',
    textInverse: '#F1F5F9',
    border: 'rgba(0, 0, 0, 0.06)',
    borderLight: 'rgba(0, 0, 0, 0.1)',
    overlay: 'rgba(0, 0, 0, 0.4)',
    shadow: 'rgba(0, 0, 0, 0.08)',
    cardGradientStart: '#FFFFFF',
    cardGradientEnd: '#F1F5F9',
    tabBar: '#FFFFFF',
    statusBar: '#F1F5F9',
  },

  // ── Category Colors ──────────────────────────────────────
  category: {
    plumbing: '#007BFF',
    electrical: '#FF9900',
    salon: '#EC4899',
    carServices: '#64748B',
    carpentry: '#D97706',
    painting: '#00B4FF',
    cleaning: '#22C55E',
    hvac: '#14B8A6',
    generalHandyman: '#6B7280',
    mechanics: '#EF4444',
    other: '#00B4FF',
  },

  // ── Gradients ────────────────────────────────────────────
  gradients: {
    primary: ['#007BFF', '#00B4FF'],
    secondary: ['#00B4FF', '#38BDF8'],
    accent: ['#FF9900', '#FFC107'],
    success: ['#10B981', '#059669'],
    dark: ['#1E293B', '#0F172A'],
    card: ['#334155', '#1E293B'],
    premium: ['#007BFF', '#FF9900'],
  },
};

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
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 24,
  full: 9999,
};

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
};

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  }),
};

export type ThemeMode = 'dark' | 'light';
export type ThemeColors = typeof colors.dark;

export const getTheme = (mode: ThemeMode) => ({
  colors: colors[mode],
  spacing,
  borderRadius,
  fontSize,
  fontWeight,
  shadows,
  gradients: colors.gradients,
  categoryColors: colors.category,
});

export type Theme = ReturnType<typeof getTheme>;
