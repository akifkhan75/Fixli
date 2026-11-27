import { readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

/**
 * Accessibility guard (doc 27 R7; the project has no ESLint yet). Every touchable must declare what it
 * is, and a touchable with only an icon inside must also say what it does.
 */
const ROOT = path.join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) { if (!['node_modules', '__tests__'].includes(f)) walk(p, out); }
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function touchables(src: string) {
  const found: { line: number; tag: string; body: string }[] = [];
  for (const m of src.matchAll(/<(TouchableOpacity|Pressable|PressableScale|TouchableHighlight)\b/g)) {
    let i = m.index! + m[0].length, depth = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '{') depth++; else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0 && src[i - 1] !== '=') break;
      i++;
    }
    const tag = src.slice(m.index!, i + 1);
    const end = src.indexOf(`</${m[1]}>`, i);
    found.push({ line: src.slice(0, m.index).split('\n').length, tag, body: tag.endsWith('/>') || end < 0 ? '' : src.slice(i + 1, end) });
  }
  return found;
}

describe('accessibility', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))];
  const rel = (f: string) => path.relative(ROOT, f);

  it('every touchable has an accessibilityRole', () => {
    const missing: string[] = [];
    for (const f of files) for (const t of touchables(readFileSync(f, 'utf8'))) {
      // PressableScale is a button unless told otherwise.
      if (t.tag.startsWith('<PressableScale')) continue;
      if (!t.tag.includes('accessibilityRole') && !t.tag.includes('{...')) missing.push(`${rel(f)}:${t.line}`);
    }
    expect(missing).toEqual([]);
  });

  it('icon-only touchables have an accessibilityLabel', () => {
    const missing: string[] = [];
    for (const f of files) for (const t of touchables(readFileSync(f, 'utf8'))) {
      const hasText = /<(Text|Button)\b/.test(t.body) || /\{[^}]*(label|title|name|text)[^}]*\}/i.test(t.body);
      if (!hasText && !t.tag.includes('accessibilityLabel') && !t.tag.includes('{...')) missing.push(`${rel(f)}:${t.line}`);
    }
    expect(missing).toEqual([]);
  });
});
