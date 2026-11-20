import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parser = require('@babel/parser');

export const ROOT = path.resolve(__dirname, '../..');

/** Every screen and component file (tests and generated files excluded). */
export function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name === '__tests__' || name === 'node_modules') continue;
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'app'));
  walk(path.join(ROOT, 'src'));
  return out.sort();
}

export const rel = (f: string) => path.relative(ROOT, f);

export function parse(file: string) {
  return parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] });
}

/** Depth-first walk over any AST node. */
export function walk(node: any, visit: (n: any, parent: any) => void, parent: any = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, node));
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

const attrName = (a: any) => (a.type === 'JSXAttribute' ? a.name.name : null);
export const attr = (el: any, name: string) => el.attributes.find((a: any) => attrName(a) === name);
export const hasSpread = (el: any) => el.attributes.some((a: any) => a.type === 'JSXSpreadAttribute');
export const elName = (el: any): string => (el.name.type === 'JSXIdentifier' ? el.name.name : el.name.type === 'JSXMemberExpression' ? `${el.name.object.name}.${el.name.property.name}` : '');

/** Props whose string value is shown to (or read to) the person. */
export const TEXT_PROPS = ['title', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'message', 'subtitle', 'description', 'actionLabel', 'takeLabel', 'helperText', 'error', 'errorText', 'emptyText', 'caption'];

/** Keys whose string value is shown to people. */
export const OBJECT_TEXT_KEYS = ['label', 'title', 'sub', 'subtitle', 'message', 'description', 'placeholder', 'hint', 'badge', 'text', 'body'];

/** Lines marked `// i18n-ignore` on purpose (language names are shown in their own language). */
let IGNORED = new Set<number>();

const isWords = (s: string) => /[A-Za-z؀-ۿ]{2,}/.test(s);

/** Strings an expression can evaluate to directly: 'a', `a${x}`, cond ? 'a' : 'b', x && 'a', x || 'a'. Calls (t('key')) are not text. */
function directStrings(e: any, out: { line: number; text: string }[]) {
  if (!e) return;
  if (IGNORED.has(e.loc.start.line)) return;
  switch (e.type) {
    case 'StringLiteral': if (isWords(e.value)) out.push({ line: e.loc.start.line, text: e.value }); break;
    case 'TemplateLiteral': if (e.quasis.some((q: any) => isWords(q.value.cooked))) out.push({ line: e.loc.start.line, text: e.quasis.map((q: any) => q.value.cooked).join('{}') }); break;
    case 'ConditionalExpression': directStrings(e.consequent, out); directStrings(e.alternate, out); break;
    case 'LogicalExpression': directStrings(e.right, out); break;
    case 'ParenthesizedExpression': directStrings(e.expression, out); break;
  }
}

/** Text shown to people that is written straight into the screen instead of going through t(). */
export function literalStrings(file: string): { line: number; text: string }[] {
  const ast = parse(file);
  IGNORED = new Set(fs.readFileSync(file, 'utf8').split('\n').flatMap((l, i) => (l.includes('i18n-ignore') ? [i + 1] : [])));
  const found: { line: number; text: string }[] = [];
  walk(ast, (n, parent) => {
    if (n.type === 'JSXText' && isWords(n.value.trim())) found.push({ line: n.loc.start.line, text: n.value.trim() });
    if (n.type === 'JSXExpressionContainer' && parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) directStrings(n.expression, found);
    if (n.type === 'JSXAttribute' && TEXT_PROPS.includes(n.name.name) && n.value) {
      if (n.value.type === 'StringLiteral') directStrings(n.value, found);
      if (n.value.type === 'JSXExpressionContainer') directStrings(n.value.expression, found);
    }
    // { label: 'Light' } in option lists and tables
    if (n.type === 'ObjectProperty' && !n.computed && n.key && OBJECT_TEXT_KEYS.includes(n.key.name ?? n.key.value) && (n.value.type === 'StringLiteral' || n.value.type === 'TemplateLiteral' || n.value.type === 'ConditionalExpression' || n.value.type === 'LogicalExpression')) directStrings(n.value, found);
    // setError('Please choose a reason.')
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && /^set\w*Error$/.test(n.callee.name)) for (const a of n.arguments) directStrings(a, found);
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'Alert' && n.callee.property.name === 'alert') {
      for (const a of n.arguments.slice(0, 2)) directStrings(a, found);
    }
  });
  return found;
}

const TOUCHABLES = ['TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Pressable', 'TouchableNativeFeedback'];

/** Touchables a screen reader can't describe: no role, or no label and no text inside. */
export function unlabelledTouchables(file: string): { line: number; name: string; problem: string }[] {
  const ast = parse(file);
  const found: { line: number; name: string; problem: string }[] = [];
  walk(ast, (n) => {
    if (n.type !== 'JSXElement' || !TOUCHABLES.includes(elName(n.openingElement))) return;
    const el = n.openingElement;
    if (hasSpread(el)) return; // props come from elsewhere; the wrapper is checked where it's defined
    // Text anywhere inside is read out with the button; an icon-only button needs its own label.
    let hasText = false;
    walk(n, (x) => {
      if (x === n) return;
      if ((x.type === 'JSXText' && x.value.trim()) || (x.type === 'JSXElement' && elName(x.openingElement) === 'Text')) hasText = true;
      if (x.type === 'JSXExpressionContainer' && x.expression && x.expression.type === 'CallExpression') hasText = true; // {t('...')}
    });
    if (!attr(el, 'accessibilityRole') && !attr(el, 'role')) found.push({ line: el.loc.start.line, name: elName(el), problem: 'no accessibilityRole' });
    if (!attr(el, 'accessibilityLabel') && !attr(el, 'aria-label') && !hasText) found.push({ line: el.loc.start.line, name: elName(el), problem: 'no accessibilityLabel' });
  });
  return found;
}
