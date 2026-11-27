import { colors, ThemeColors } from '../theme';

/** WCAG 2.1 contrast between two opaque #RRGGBB colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Key = keyof ThemeColors;

describe.each(['light', 'dark'] as const)('%s theme contrast', (mode) => {
  const c = colors[mode] as ThemeColors;
  const surfaces: Key[] = ['background', 'surface', 'surfaceElevated'];
  const texts: Key[] = ['textPrimary', 'textSecondary', 'textTertiary', 'primaryText', 'successText', 'errorText', 'warningText'];
  const pairs: [Key, Key][] = [
    ...texts.flatMap((t) => surfaces.map((s) => [t, s] as [Key, Key])),
    ['onPrimary', 'primary'],
    ['onPrimary', 'primaryPressed'],
    ['onPrimary', 'success'],
    ['onPrimary', 'error'],
    ['onPrimary', 'warning'],
    ['onPrimary', 'sos'],
    ['onAccent', 'accent'],
    ['primaryText', 'primarySoft'],
    ['successText', 'successSoft'],
    ['errorText', 'errorSoft'],
    ['warningText', 'warningSoft'],
  ];

  it.each(pairs)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
