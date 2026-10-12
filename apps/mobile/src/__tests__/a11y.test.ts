import * as fs from 'fs';
import { rel, ROOT, sourceFiles, unlabelledTouchables } from '../testSupport/scan';
import * as path from 'path';

describe('accessibility', () => {
  it('every button has a role, and a label unless it contains text (screen readers announce nothing otherwise)', () => {
    const bad = sourceFiles().flatMap((f) => unlabelledTouchables(f).map((p) => `${rel(f)}:${p.line} ${p.name}: ${p.problem}`));
    expect(bad).toEqual([]);
  });

  it('text is never locked to a size (Dynamic Type / font scaling must work)', () => {
    const bad = sourceFiles().filter((f) => /allowFontScaling=\{?\s*false/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(bad).toEqual([]);
  });
});

describe('no fakes', () => {
  it('no screen simulates a check or ships made-up data', () => {
    const FAKE = /setIsVerified|ai[- ]?verified|AI Verified|MOCK_[A-Z]+|fakeData|dummyData|lorem ipsum|Simulating/i;
    const bad: string[] = [];
    const go = (d: string) => {
      for (const n of fs.readdirSync(d)) {
        const f = path.join(d, n);
        if (n === '__tests__' || n === 'node_modules') continue;
        if (fs.statSync(f).isDirectory()) go(f);
        else if (/\.tsx?$/.test(n) && FAKE.test(fs.readFileSync(f, 'utf8'))) bad.push(rel(f));
      }
    };
    go(path.join(ROOT, 'app'));
    go(path.join(ROOT, 'src'));
    expect(bad).toEqual([]);
  });
});

describe('right-to-left', () => {
  it('arrows and chevrons use DirIcon so they flip in Urdu and Arabic', () => {
    const bad = sourceFiles()
      .filter((f) => !f.endsWith('DirIcon.tsx') && /<Ionicons[^>]*name=["'{]+\s*["']?(chevron-forward|chevron-back|arrow-back|arrow-forward)/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it('text is not pinned to the left or right (it follows the language), except phone numbers which always read left to right', () => {
    const bad = sourceFiles()
      .filter((f) => !f.endsWith('PhoneField.tsx') && /textAlign: ?['"](left|right)['"]|align=["'](left|right)["']/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(bad).toEqual([]);
  });
});

// ── contrast (WCAG: normal text needs 4.5 : 1) ──────────────────────────────────────────────
import { colors } from '../theme';
import { parse, walk } from '../testSupport/scan';

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

describe('colour contrast', () => {
  it('the contrast helper agrees with known values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 1);
  });

  it.each(['light', 'dark'] as const)('%s: text on its backgrounds is at least 4.5 : 1', (mode) => {
    const c = colors[mode];
    const fails: string[] = [];
    const check = (fg: keyof typeof c, bgs: (keyof typeof c)[]) => {
      for (const bg of bgs) {
        const r = contrast(c[fg] as string, c[bg] as string);
        if (r < 4.5) fails.push(`${String(fg)} on ${String(bg)} = ${r.toFixed(2)}`);
      }
    };
    check('textPrimary', ['background', 'surface', 'surfaceElevated']);
    check('textSecondary', ['background', 'surface', 'surfaceElevated']);
    check('textTertiary', ['background', 'surface']);
    for (const t of ['primaryText', 'errorText', 'successText', 'warningText'] as const) check(t, ['background', 'surface']);
    expect(fails).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('%s: white text on buttons and badges (primary, danger, success, warning, SOS) is at least 4.5 : 1', (mode) => {
    const c = colors[mode];
    const fails = (['primary', 'error', 'success', 'warning', 'sos'] as const)
      .map((fill) => [fill, contrast(c.onPrimary, c[fill])] as const)
      .filter(([, r]) => r < 4.5)
      .map(([fill, r]) => `onPrimary on ${fill} = ${r.toFixed(2)}`);
    expect(fails).toEqual([]);
  });

  it('screens never write text in a fill colour (use primaryText / errorText / successText / warningText)', () => {
    const FILL = new Set(['primary', 'error', 'success', 'warning', 'accent', 'sos', 'secondary']);
    const bad: string[] = [];
    for (const f of sourceFiles()) {
      walk(parse(f), (n, parent) => {
        const isTextColor =
          (n.type === 'JSXAttribute' && n.name.name === 'color' && parent?.name?.name === 'Text') ||
          (n.type === 'ObjectProperty' && !n.computed && n.key.name === 'color');
        if (!isTextColor) return;
        const v = n.type === 'JSXAttribute' ? n.value?.expression : n.value;
        const pick = (e: any) => (e?.type === 'MemberExpression' && e.object?.property?.name === 'colors' && FILL.has(e.property.name) ? [e.property.name] : []);
        const used = [...pick(v), ...(v?.type === 'ConditionalExpression' ? [...pick(v.consequent), ...pick(v.alternate)] : [])];
        for (const u of used) bad.push(`${rel(f)}:${n.loc.start.line} uses ${u}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('touch targets', () => {
  it('buttons are at least 48 pt tall, 56 pt for the large primary ones', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/components/ds/Button.tsx'), 'utf8');
    expect(src).toMatch(/minHeight = 52/);
    expect(src).toMatch(/minHeight = 48/);
    expect(src).toMatch(/minHeight = 56/);
  });
});

describe('motion', () => {
  it('every file that animates also respects "Reduce motion"', () => {
    const files = [...sourceFiles(), ...fs.readdirSync(path.join(ROOT, 'src/hooks')).map((n) => path.join(ROOT, 'src/hooks', n))].filter((f) => /\.tsx?$/.test(f));
    const bad = files
      .filter((f) => !f.endsWith('useReduceMotion.ts') && /Animated\.(timing|spring|parallel|sequence|loop)|LayoutAnimation\.(configureNext|spring|easeInEaseOut)/.test(fs.readFileSync(f, 'utf8')) && !/useReduceMotion/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(bad).toEqual([]);
  });
});
