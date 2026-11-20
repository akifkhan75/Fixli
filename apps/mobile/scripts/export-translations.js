// Writes every app sentence as one CSV for native-speaker review (owner decision O13):
//   node scripts/export-translations.js > translations-review.csv
// Columns: key, English, Arabic, Urdu, area. Reviewers fix the Arabic and Urdu columns; the corrected
// file is then imported by hand into src/i18n/ar.ts and ur.ts. Keep {placeholders} exactly as they are.
const fs = require('fs');
const path = require('path');

const read = (name) => {
  const out = {};
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', `${name}.ts`), 'utf8');
  for (const m of src.matchAll(/^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$/gm)) out[JSON.parse(m[1])] = JSON.parse(m[2]);
  return out;
};
const [en, ar, ur] = ['en', 'ar', 'ur'].map(read);
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const area = (k) => (k.startsWith('safety.') ? 'SAFETY: needs legal review too (L10)' : k.startsWith('error.') ? 'error message' : k.split('.')[0]);

console.log(['key', 'English', 'Arabic', 'Urdu', 'area'].join(','));
for (const k of Object.keys(en).sort()) console.log([k, en[k], ar[k], ur[k], area(k)].map(csv).join(','));
