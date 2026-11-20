// Runs helpers/api.js without a phone, against a running API, in the order the flows use it.
// This proves the backend half of every flow (the part Maestro cannot show you when it breaks).
//   API=http://127.0.0.1:3200/api node .maestro/helpers/check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = process.env.API ?? 'http://127.0.0.1:3002/api';
const code = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'api.js'), 'utf8');

// Maestro's http is synchronous; curl gives the same behaviour here.
const http = {
  request(url, { method = 'GET', headers = {}, body } = {}) {
    const args = ['-sS', '-X', method, '-w', '\n%{http_code}', url];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (body !== undefined) args.push('--data', body);
    const out = execFileSync('curl', args, { encoding: 'utf8' });
    const i = out.lastIndexOf('\n');
    const status = Number(out.slice(i + 1));
    return { ok: status >= 200 && status < 300, status, body: out.slice(0, i) };
  },
};
const json = (s) => JSON.parse(s);
const output = {};
const run = (ACTION) => { new Function('http', 'json', 'output', 'API', 'ACTION', code)(http, json, output, API, ACTION); };

const step = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '-', e.message); process.exitCode = 1; throw e; } };
const get = (token, p) => json(http.request(API + p, { headers: { Authorization: `Bearer ${token}` } }).body);
const login = (phone) => json(http.request(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, countryCode: 'PK', password: 'Maestro-pass-42', deviceId: 'check-' + phone.slice(-4) }) }).body).token;

try {
  step('catalog gives ids for the deep link', () => { run('catalog'); if (!output.categoryId || !output.issue) throw new Error('no ids'); });
  // On the phone, the worker flips the "Online" switch; here we do it by hand.
  const wt = login('+923009990002');
  http.request(`${API}/workers/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wt}` }, body: JSON.stringify({ isOnline: true }) });
  step('customer sends a request', () => run('customerRequests'));
  step('worker sends a price', () => run('workerOffers'));
  step('customer books it', () => run('customerBooks'));
  step('worker drives it to finished', () => run('workerCompletes'));
  const ct = login('+923009990001');
  step('job is now awaiting confirmation', () => { const j = get(ct, `/job-requests/${output.jobId}`); if (j.status !== 'AWAITING_CONFIRMATION') throw new Error('status is ' + j.status); });
  step('worker marks cash received', () => run('workerMarksCash'));
  step('customer confirms', () => run('customerConfirms'));
  step('job is completed', () => { const j = get(ct, `/job-requests/${output.jobId}`); if (j.status !== 'COMPLETED') throw new Error('status is ' + j.status); });
  console.log('\nAll helper actions work against', API);
} catch {
  console.error('\nSome helper action failed (see above).');
}
