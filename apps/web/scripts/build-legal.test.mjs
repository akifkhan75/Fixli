import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, markdownToHtml } from './build-legal.mjs';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/legal');

test('markdown becomes safe, readable html', () => {
  const html = markdownToHtml('# Title\n\nHello **bold** & <script>alert(1)</script>\n\n- one\n- two\n\n1. first\n\n> note [Company name]');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong> &amp; &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  assert.match(html, /<ol>\s*<li>first<\/li>\s*<\/ol>/);
  assert.match(html, /<mark[^>]*>\[Company name\]<\/mark>/);
});

test('all six pages are written (English and Urdu)', () => {
  assert.equal(build(), 6);
});

test('the legal texts do not promise things the product does not do', () => {
  // Cash only, people check IDs, no escrow: the old texts claimed otherwise (doc 27 F8.3).
  const forbidden = [/\bOCR\b/i, /we hold (the )?funds/i, /hold funds in escrow/i, /payment gateway/i, /marketing communications/i, /Payments can be made via/i, /binding decision regarding refunds/i];
  for (const f of readdirSync(docs).filter((n) => n.endsWith('.md') && n !== 'README.md')) {
    const text = readFileSync(path.join(docs, f), 'utf8');
    for (const re of forbidden) assert.doesNotMatch(text, re, `${f} says ${re}`);
  }
});

test('there is exactly one terms file per language', () => {
  const names = readdirSync(docs).filter((n) => /^terms/.test(n)).sort();
  assert.deepEqual(names, ['terms-of-service.md', 'terms-of-service.ur.md']);
});
