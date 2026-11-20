// Turns docs/legal/*.md into plain, fast, readable web pages (doc 27 F8.3):
//   /privacy.html  /terms.html  /delete-account.html  and the Urdu ones under /ur/
// Run by `pnpm build` (prebuild) and `pnpm dev`; the output goes to public/ and is not committed.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../../docs/legal');
const out = path.resolve(here, '../public');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]*)\)/g, '<a href="$2">$1</a>')
  // [square brackets] are decisions still open for the company's lawyer: show them, highlighted
  .replace(/\[([^\]]+)\]/g, '<mark title="To be completed before launch">[$1]</mark>');

export function markdownToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const html = [];
  let list = null; let para = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); closeList(); html.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); closeList(); html.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { flushPara(); if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    closeList();
    para.push(line.trim());
  }
  flushPara(); closeList();
  return html.join('\n');
}

const page = (title, body, lang) => `<!doctype html>
<html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Fixli</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 17px/1.6 -apple-system, "Segoe UI", Roboto, "Noto Nastaliq Urdu", sans-serif; max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  h1 { line-height: 1.2; } h2 { margin-top: 2rem; } blockquote { margin: 1rem 0; padding: .5rem 1rem; border-inline-start: 4px solid #d97706; background: rgba(217,119,6,.1); }
  mark { background: rgba(250,204,21,.35); color: inherit; padding: 0 .15em; border-radius: 3px; }
  a { color: #0066db; } @media (prefers-color-scheme: dark) { a { color: #38bdf8; } }
  nav { margin-bottom: 1.5rem; font-size: .95rem; display: flex; gap: 1rem; flex-wrap: wrap; }
</style>
</head>
<body>
<nav><a href="/">Fixli</a><a href="${lang === 'ur' ? '/ur' : ''}/privacy.html">${lang === 'ur' ? 'پرائیویسی' : 'Privacy'}</a><a href="${lang === 'ur' ? '/ur' : ''}/terms.html">${lang === 'ur' ? 'شرائط' : 'Terms'}</a><a href="${lang === 'ur' ? '/ur' : ''}/delete-account.html">${lang === 'ur' ? 'اکاؤنٹ حذف کریں' : 'Delete your account'}</a><a href="${lang === 'ur' ? '' : '/ur'}/privacy.html" lang="${lang === 'ur' ? 'en' : 'ur'}">${lang === 'ur' ? 'English' : 'اردو'}</a></nav>
${body}
</body></html>`;

const PAGES = [['privacy', 'privacy-policy', 'Privacy Policy'], ['terms', 'terms-of-service', 'Terms of Service'], ['delete-account', 'delete-account', 'Delete your account']];

export function build() {
  let n = 0;
  for (const lang of ['en', 'ur']) {
    mkdirSync(path.join(out, lang === 'ur' ? 'ur' : ''), { recursive: true });
    for (const [slug, file, title] of PAGES) {
      const f = path.join(src, lang === 'ur' ? `${file}.ur.md` : `${file}.md`);
      if (!existsSync(f)) { if (lang === 'ur') continue; throw new Error(`Missing ${f}`); }
      const md = readFileSync(f, 'utf8');
      const heading = md.match(/^#\s+(.*)$/m)?.[1] ?? title;
      writeFileSync(path.join(out, lang === 'ur' ? 'ur' : '', `${slug}.html`), page(heading, markdownToHtml(md), lang));
      n++;
    }
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Wrote ${build()} legal pages to public/`);
