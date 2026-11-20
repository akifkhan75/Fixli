// Prints the size of the exported app bundle and fails the build when it grows past the budget
// (doc 27 F7.5). Usage: node scripts/bundle-size.js <export-dir> [budget-bytes]
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const budget = Number(process.argv[3] ?? 9 * 1024 * 1024); // 7.3 MB at the time of writing, plus headroom
if (!dir) { console.error('Usage: bundle-size.js <export-dir> [budget-bytes]'); process.exit(2); }

const files = [];
const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); fs.statSync(f).isDirectory() ? walk(f) : files.push(f); } };
walk(dir);
const bundles = files.filter((f) => /\.(hbc|bundle|js)$/.test(f) && f.includes(`${path.sep}js${path.sep}`));
if (!bundles.length) { console.error(`No JS bundle found under ${dir}`); process.exit(2); }

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
let worst = 0;
for (const f of bundles) {
  const size = fs.statSync(f).size;
  worst = Math.max(worst, size);
  console.log(`${mb(size).padStart(9)}  ${path.relative(dir, f)}`);
}
console.log(`Budget: ${mb(budget)}`);
if (worst > budget) { console.error(`Bundle is ${mb(worst)}, over the ${mb(budget)} budget. Find out what grew before raising it.`); process.exit(1); }
