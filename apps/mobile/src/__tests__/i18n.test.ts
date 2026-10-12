import * as fs from 'fs';
import * as path from 'path';
import { ar } from '../i18n/ar';
import { en } from '../i18n/en';
import { ur } from '../i18n/ur';
import { getLocale, setLocale, t, tn } from '../i18n';
import { SOS_COPY } from '../safety/copy';
import { literalStrings, parse, rel, ROOT, sourceFiles, walk } from '../testSupport/scan';


const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const LOCALES = { ar, ur } as const;

/** Every .ts/.tsx under app/ and src/ except tests and the language files. */
function codeFiles(): string[] {
  const out: string[] = [];
  const go = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n);
      if (n === '__tests__' || n === 'node_modules' || f.endsWith(path.join('src', 'i18n'))) continue;
      if (fs.statSync(f).isDirectory()) go(f);
      else if (/\.tsx?$/.test(n) && !n.endsWith('.d.ts')) out.push(f);
    }
  };
  go(path.join(ROOT, 'app'));
  go(path.join(ROOT, 'src'));
  return out.sort();
}

/** Keys passed as a literal first argument to t() / tn(), and where. */
function usedKeys() {
  const found: { key: string; plural: boolean; where: string }[] = [];
  for (const f of codeFiles()) {
    const ast = parse(f);
    walk(ast, (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && (n.callee.name === 't' || n.callee.name === 'tn')) {
        const a = n.arguments[0];
        if (a && a.type === 'StringLiteral') found.push({ key: a.value, plural: n.callee.name === 'tn', where: `${rel(f)}:${n.loc.start.line}` });
      }
    });
  }
  return found;
}

describe('translations', () => {
  it('Arabic and Urdu have exactly the English keys, with the same {placeholders}', () => {
    for (const [name, lang] of Object.entries(LOCALES)) {
      expect(Object.keys(lang).sort()).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(en)) {
        expect({ lang: name, key: k, placeholders: placeholders(lang[k]) }).toEqual({ lang: name, key: k, placeholders: placeholders(v) });
        expect(lang[k].trim()).not.toBe('');
      }
    }
  });

  it('Arabic and Urdu text is actually translated (not left in English), except brand words and symbols', () => {
    const SAME_OK = /^(?:\p{Extended_Pictographic}|Fixli|SOS|\{\w+\}|[\d\s.,·:\-–—/…!?()%+&'’"|]|↑|↓)*$/u;
    for (const [name, lang] of Object.entries(LOCALES)) {
      const untranslated = Object.entries(en).filter(([k, v]) => lang[k] === v && !SAME_OK.test(v.replace(/Fixli|SOS|JC-\d+/g, '')));
      expect({ lang: name, untranslated: untranslated.map(([k]) => k) }).toEqual({ lang: name, untranslated: [] });
    }
  });

  it('every key the code asks for exists, and counted texts have both forms', () => {
    const missing: string[] = [];
    for (const u of usedKeys()) {
      if (u.plural) {
        for (const form of ['one', 'other']) if (!(`${u.key}.${form}` in en)) missing.push(`${u.key}.${form} (${u.where})`);
      } else if (!(u.key in en)) missing.push(`${u.key} (${u.where})`);
    }
    expect(missing).toEqual([]);
  });

  it('no key is left unused (they rot, and each one is a sentence someone has to translate)', () => {
    const used = new Set<string>();
    for (const u of usedKeys()) { used.add(u.key); used.add(`${u.key}.one`); used.add(`${u.key}.other`); }
    // jobEvent.* is looked up as jobEvent.<event>.<viewer> (utils/jobStatus.ts), error.* by the server's error code (services/api.ts)
    const unused = Object.keys(en).filter((k) => !used.has(k) && !k.startsWith('jobEvent.') && !k.startsWith('error.'));
    expect(unused).toEqual([]);
  });

  it('t() fills {placeholders}, falls back to English for a missing word, and tn() picks one/other', () => {
    setLocale('en');
    expect(t('customerJob.agreedPrice', { price: 'Rs 1,500' })).toBe('Agreed price: Rs 1,500');
    expect(tn('common.jobs', 1)).toBe('1 job');
    expect(tn('common.jobs', 2)).toBe('2 jobs');
    expect(t('no.such.key')).toBe('no.such.key');
    setLocale('ur');
    expect(getLocale()).toBe('ur');
    expect(t('customerJob.agreedPrice', { price: 'Rs 1,500' })).toContain('Rs 1,500');
    expect(t('customerJob.agreedPrice', { price: 'x' })).not.toContain('Agreed');
    setLocale('en');
  });
});

describe('no text is written straight into a screen', () => {
  it('every sentence a person reads goes through t() (mark a deliberate exception with // i18n-ignore)', () => {
    const offenders = sourceFiles().flatMap((f) => literalStrings(f).map((s) => `${rel(f)}:${s.line}  ${JSON.stringify(s.text)}`));
    expect(offenders).toEqual([]);
  });

  it('t() is never called while a file loads (the language is not known yet): tables of labels are functions', () => {
    const early: string[] = [];
    for (const f of codeFiles()) {
      const ast = parse(f);
      const visit = (node: any, inFn: boolean) => {
        if (!node || typeof node.type !== 'string') return;
        const isFn = /Function/.test(node.type) || node.type === 'ArrowFunctionExpression' || node.type === 'ClassMethod' || node.type === 'ObjectMethod';
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && (node.callee.name === 't' || node.callee.name === 'tn') && !inFn) early.push(`${rel(f)}:${node.loc.start.line}`);
        for (const k of Object.keys(node)) {
          if (k === 'loc') continue;
          const v = node[k];
          if (Array.isArray(v)) v.forEach((c) => visit(c, inFn || isFn));
          else if (v && typeof v.type === 'string') visit(v, inFn || isFn);
        }
      };
      visit(ast, false);
    }
    expect(early).toEqual([]);
  });
});

describe('safety wording holds in every language (legal L10; the Urdu and Arabic still need native and legal review)', () => {
  const NUMBERS = /(?<![\d٠-٩۰-۹])(15|115|16|1122|911|999|112|١٥|١١٥|١٦|١١٢٢|۱۵|۱۱۵|۱۶|۱۱۲۲)(?![\d٠-٩۰-۹])/;
  const flat = (o: unknown): string[] =>
    typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as (n: number) => string)(3))] : Array.isArray(o) ? o.flatMap(flat) : o && typeof o === 'object' ? Object.values(o).flatMap(flat) : [];

  it.each(['en', 'ar', 'ur'] as const)('%s: the safety text types no emergency number and does not claim Fixli called anyone', (loc) => {
    setLocale(loc);
    const text = flat(SOS_COPY).join('\n');
    setLocale('en');
    expect(text).not.toMatch(NUMBERS);
    expect(text.length).toBeGreaterThan(300);
    if (loc === 'en') expect(text).not.toMatch(/we (have )?(called|contacted|alerted) (the )?(police|ambulance|emergency|rescue)/i);
  });

  it('the line that says Fixli does not call emergency services exists, and differs, in every language', () => {
    expect(new Set([en['safety.lifeBody'], ar['safety.lifeBody'], ur['safety.lifeBody']]).size).toBe(3);
    expect(en['safety.lifeBody']).toMatch(/does not contact emergency services/);
  });
});

describe('server error messages', () => {
  const { ApiError } = jest.requireActual('../services/api') as typeof import('../services/api');

  it('a known error code is shown in the current language; an unknown one keeps the server\'s own words', () => {
    setLocale('ur');
    expect(new ApiError('Offer expired', 409, 'OFFER_EXPIRED').userMessage).toBe(ur['error.OFFER_EXPIRED']);
    expect(new ApiError('Something odd', 400, 'SOMETHING_NEW').userMessage).toBe('Something odd');
    expect(new ApiError('No code at all', 500).userMessage).toBe('No code at all');
    setLocale('en');
    expect(new ApiError('x', 409, 'OFFER_EXPIRED').userMessage).toBe(en['error.OFFER_EXPIRED']);
  });

  it('every error.CODE we translate is a code the API really sends', () => {
    const apiSrc = path.resolve(ROOT, '../api/src');
    const codes = new Set<string>();
    const go = (d: string) => {
      for (const n of fs.readdirSync(d)) {
        const f = path.join(d, n);
        if (fs.statSync(f).isDirectory()) go(f);
        else if (/\.ts$/.test(n) && !n.endsWith('.spec.ts')) for (const m of fs.readFileSync(f, 'utf8').matchAll(/code: '([A-Z_]+)'/g)) codes.add(m[1]);
      }
    };
    go(apiSrc);
    const unknown = Object.keys(en).filter((k) => k.startsWith('error.')).map((k) => k.slice(6)).filter((c) => !codes.has(c));
    expect(unknown).toEqual([]);
  });
});
