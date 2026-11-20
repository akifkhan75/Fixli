// Load test (doc 27 F8.1). Starts TWO API instances plus Redis fan-out, seeds users straight into
// the database, then drives the real flows and checks the targets:
//   - REST p95 under 300 ms (sign-in checked separately: it is deliberately slow, a password hash)
//   - socket delivery p95 under 1 s, with the sender on one instance and the receiver on the other
//   - no 5xx and no dropped sockets
//
//   pnpm --filter @fixli/api build && pnpm --filter @fixli/api db:seed:catalog
//   DATABASE_URL=... REDIS_URL=redis://127.0.0.1:6399 node load/run.mjs
// Knobs: CUSTOMERS (200), WORKERS (400), RAMP_SECONDS (30), LOGINS (40).
// "Pilot scale x 10": the pilot is assumed to be about 20 requests in flight at peak, so 200 requests
// arriving over 30 s (about 6.7 new requests a second, each with ~10 calls and two live sockets).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { io } = require('socket.io-client');

const env = (k, d) => process.env[k] ?? d;
const CUSTOMERS = Number(env('CUSTOMERS', 200));
const WORKERS = Number(env('WORKERS', 400));
const RAMP = Number(env('RAMP_SECONDS', 30)) * 1000;
const LOGINS = Number(env('LOGINS', 40));
const DB = env('DATABASE_URL', '');
const REDIS = env('REDIS_URL', '');
const SECRET = env('JWT_SECRET', 'load-test-secret-load-test-secret-load-test-secret');
const PORTS = [3101, 3102];
const BASE = PORTS.map((p) => `http://127.0.0.1:${p}`);
const TAG = `load${Date.now()}`;
const TARGET = { restP95: 300, loginP95: 1500, socketP95: 1000 };
if (!DB || !REDIS) { console.error('Set DATABASE_URL and REDIS_URL.'); process.exit(2); }

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ── measuring ───────────────────────────────────────────────────────────────
const lat = new Map(); const errs = new Map();
const rec = (name, ms) => { (lat.get(name) ?? lat.set(name, []).get(name)).push(ms); };
const bad = (name, why) => { const k = `${name}: ${why}`; errs.set(k, (errs.get(k) ?? 0) + 1); };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

let hop = 0;
async function call(name, method, url, { token, body, expect = [200, 201, 204] } = {}) {
  hop += 1;
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.${(hop >> 16) & 255}.${(hop >> 8) & 255}.${hop & 255}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ms = performance.now() - t0;
    const text = await res.text();
    if (!expect.includes(res.status)) { bad(name, `HTTP ${res.status}`); return { ok: false, status: res.status, body: text }; }
    rec(name, ms);
    return { ok: true, status: res.status, body: text ? JSON.parse(text) : null };
  } catch (e) { bad(name, e.message); return { ok: false }; }
}

// ── servers ─────────────────────────────────────────────────────────────────
const servers = [];
async function startServers() {
  for (const [i, port] of PORTS.entries()) {
    const p = spawn('node', ['dist/main'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development', DATABASE_URL: DB, REDIS_URL: REDIS, JWT_SECRET: SECRET, RUN_BACKGROUND_JOBS: i === 0 ? 'true' : 'false', ADMIN_TOTP_REQUIRED: 'false', LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    p.stdout.on('data', () => {}); p.stderr.on('data', (d) => { if (/error/i.test(String(d))) process.stderr.write(`[api:${port}] ${d}`); });
    servers.push(p);
  }
  for (const b of BASE) {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${b}/api/health/ready`)).status === 200) break; } catch {} await sleep(500); if (i === 59) throw new Error(`${b} did not start`); }
  }
}
const stopServers = () => servers.forEach((s) => s.kill('SIGTERM'));

// ── seeding ─────────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function mint(userId, type, sid) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, type, sid, iat: now, exp: now + 3600 });
  return `${head}.${payload}.${createHmac('sha256', SECRET).update(`${head}.${payload}`).digest('base64url')}`;
}

async function seed() {
  const cat = await prisma.serviceCategory.findUnique({ where: { name: 'PLUMBING' } });
  if (!cat) throw new Error('Run the catalogue seed first (pnpm --filter @fixli/api db:seed:catalog).');
  const hash = await bcrypt.hash('Load-test-pass-42', 12);
  const mk = async (kind, i) => {
    const phone = `+92300${String(kind === 'c' ? 1_000_000 + i : 5_000_000 + i)}`;
    const u = await prisma.user.create({ data: { name: `${kind}${i}`, email: `${TAG}-${kind}${i}@t.com`, phone, password: hash, type: kind === 'c' ? 'customer' : 'worker', countryCode: 'PK' } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `${TAG}-${kind}${i}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 7_200_000) } });
    return { id: u.id, phone, token: mint(u.id, u.type, s.id), type: u.type };
  };
  const workers = [];
  for (let i = 0; i < WORKERS; i++) {
    const w = await mk('w', i);
    await prisma.worker.create({ data: { id: w.id, activationStatus: 'ACTIVE', isOnline: true, isVerified: true, serviceRadius: 15, serviceLat: 24.92 + (Math.random() - 0.5) * 0.04, serviceLng: 67.09 + (Math.random() - 0.5) * 0.04, rating: 3.5 + Math.random() * 1.5, services: { create: [{ categoryId: cat.id }] }, workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) } } });
    workers.push(w);
  }
  const customers = [];
  for (let i = 0; i < CUSTOMERS; i++) {
    const c = await mk('c', i);
    c.addressId = (await prisma.address.create({ data: { userId: c.id, streetAddress: `House ${i}`, city: 'Karachi', area: 'Gulshan', country: 'PK', latitude: 24.92 + (Math.random() - 0.5) * 0.02, longitude: 67.09 + (Math.random() - 0.5) * 0.02, isDefault: true } })).id;
    customers.push(c);
  }
  return { cat, workers, customers };
}

async function cleanup(users) {
  const ids = users.map((u) => u.id);
  await prisma.conversation.deleteMany({ where: { jobRequest: { customerId: { in: ids } } } }).catch(() => {});
  await prisma.jobRequest.deleteMany({ where: { customerId: { in: ids } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.address.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.workingHours.deleteMany({ where: { workerId: { in: ids } } }).catch(() => {});
  await prisma.worker.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
}

// ── sockets: wait for one event, timing from `t0` ────────────────────────────
const sockets = []; let dropped = 0;
function connect(url, token) {
  return new Promise((resolve) => {
    const s = io(`${url}/rt`, { auth: { token }, transports: ['websocket'], reconnection: false });
    const waiters = [];
    s.onAny((type, env) => { for (const w of [...waiters]) if (w.type === type && w.match(env)) { waiters.splice(waiters.indexOf(w), 1); w.done(performance.now()); } });
    s.on('disconnect', (why) => { if (why !== 'io client disconnect') dropped += 1; });
    s.on('ready', () => resolve({ s, waitFor: (type, match = () => true, ms = 5000) => new Promise((res) => { const w = { type, match: (e) => match(e?.data ?? e), done: res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms); }) }));
    s.on('connect_error', () => { bad('socket', 'connect_error'); resolve(null); });
    sockets.push(s);
  });
}

// ── one customer's journey ───────────────────────────────────────────────────
async function journey(c, ctx) {
  const A = BASE[0]; const B = BASE[1];
  const via = () => pick(BASE);
  const issue = ctx.issueCode;
  const created = await call('create request (matching)', 'POST', `${via()}/api/job-requests`, { token: c.token, body: { categoryId: ctx.cat.id, issueCodes: [issue], addressId: c.addressId, when: 'TODAY', idempotencyKey: `${TAG}-${c.id}` } });
  if (!created.ok) return;
  const job = created.body;
  await call('read request', 'GET', `${via()}/api/job-requests/${job.id}`, { token: c.token });

  const matched = await prisma.jobMatch.findMany({ where: { jobRequestId: job.id }, take: 10, orderBy: { rank: 'asc' } });
  if (!matched.length) { bad('flow', 'no worker was matched'); return; }
  // A professional can't be booked twice for the same time (a real rule), so offers come from ones still free.
  const workers = matched.map((m) => ctx.byId.get(m.workerId)).filter((w) => w && !ctx.booked.has(w.id)).slice(0, 2);
  if (!workers.length) { ctx.skipped += 1; return; }

  // The customer listens on instance A; the workers answer through instance B.
  const cs = await connect(A, c.token);
  if (!cs) return;
  const offerSeen = cs.waitFor('offers.updated', (d) => d?.jobId === job.id);
  const t0 = performance.now();
  const feed = call('worker feed', 'GET', `${B}/api/workers/me/requests`, { token: workers[0].token });
  const offered = await Promise.all(workers.map((w, i) => call('send price', 'POST', `${B}/api/job-requests/${job.id}/offers`, { token: w.token, body: { amount: 150_000 + i * 10_000, etaMinutes: 30 } })));
  await feed;
  const seenAt = await offerSeen;
  if (seenAt) rec('socket: price reaches customer (other instance)', seenAt - t0); else bad('socket: price reaches customer (other instance)', 'never arrived');
  if (!offered.every((o) => o.ok)) return;

  const list = await call('list prices', 'GET', `${via()}/api/job-requests/${job.id}/offers`, { token: c.token });
  const offer = list.ok && (list.body.items ?? list.body)[0];
  if (!offer) { bad('flow', 'no price listed'); return; }
  const winnerId = offer.worker?.id ?? offer.workerId;
  if (ctx.booked.has(winnerId)) { ctx.skipped += 1; return; } // another journey booked them a moment ago
  ctx.booked.add(winnerId);
  const booked = await call('book (accept price)', 'POST', `${via()}/api/offers/${offer.id}/accept`, { token: c.token });
  if (!booked.ok) return;

  const conv = await call('open chat', 'GET', `${via()}/api/conversations/by-job/${job.id}`, { token: c.token });
  if (!conv.ok) return;
  const winner = ctx.byId.get(offer.worker?.id ?? offer.workerId) ?? workers[0];
  const ws = await connect(B, winner.token);
  if (ws) {
    for (let i = 0; i < 3; i++) {
      const clientId = `${randomUUID()}`;
      const got = ws.waitFor('message.created', (d) => d?.clientId === clientId);
      const t1 = performance.now();
      const sent = await call('send chat message', 'POST', `${A}/api/conversations/${conv.body.id}/messages`, { token: c.token, body: { clientId, text: `hello ${i}` } });
      if (!sent.ok) break;
      const at = await got;
      if (at) rec('socket: chat message reaches other instance', at - t1); else bad('socket: chat message reaches other instance', 'never arrived');
      const back = cs.waitFor('message.created', (d) => d?.clientId === `${clientId}-r`);
      const t2 = performance.now();
      await call('send chat reply', 'POST', `${B}/api/conversations/${conv.body.id}/messages`, { token: winner.token, body: { clientId: `${clientId}-r`, text: 'ok' } });
      const bat = await back;
      if (bat) rec('socket: chat reply reaches other instance', bat - t2); else bad('socket: chat reply reaches other instance', 'never arrived');
    }
  }
  await call('notifications list', 'GET', `${via()}/api/notifications`, { token: c.token });
  await call('my requests', 'GET', `${via()}/api/job-requests`, { token: c.token });
}

// ── run ─────────────────────────────────────────────────────────────────────
let users = [];
try {
  console.log(`Seeding ${CUSTOMERS} customers and ${WORKERS} workers…`);
  const { cat, workers, customers } = await seed();
  users = [...workers, ...customers];
  const issue = (await prisma.serviceIssue.findFirst({ where: { categoryId: cat.id, isActive: true } }))?.code;
  if (!issue) throw new Error('The catalogue has no problems for PLUMBING.');
  console.log('Starting two API instances…');
  await startServers();
  const ctx = { cat, issueCode: issue, byId: new Map(workers.map((w) => [w.id, w])), booked: new Set(), skipped: 0 };

  console.log(`Running ${CUSTOMERS} journeys over ${RAMP / 1000}s, plus ${LOGINS} sign-ins…`);
  const started = performance.now();
  const jobs = customers.map((c, i) => sleep((i / CUSTOMERS) * RAMP).then(() => journey(c, ctx)));
  const logins = Array.from({ length: LOGINS }, (_, i) => sleep((i / LOGINS) * RAMP).then(() => call('sign in (password check)', 'POST', `${pick(BASE)}/api/auth/login`, { body: { phone: customers[i % customers.length].phone, countryCode: 'PK', password: 'Load-test-pass-42', deviceId: `${TAG}-login-${i}-device` } })));
  await Promise.all([...jobs, ...logins]);
  const seconds = (performance.now() - started) / 1000;

  // ── report ──
  const rows = [...lat].map(([name, a]) => ({ name, n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: Math.max(...a) })).sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\n${'operation'.padEnd(52)}${'n'.padStart(6)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'p99'.padStart(8)}${'max'.padStart(8)}   (ms)`);
  for (const r of rows) console.log(`${r.name.padEnd(52)}${String(r.n).padStart(6)}${r.p50.toFixed(0).padStart(8)}${r.p95.toFixed(0).padStart(8)}${r.p99.toFixed(0).padStart(8)}${r.max.toFixed(0).padStart(8)}`);
  console.log(`\n${rows.reduce((n, r) => n + r.n, 0)} measured calls in ${seconds.toFixed(0)} s; dropped sockets: ${dropped}; journeys skipped because every matched professional was already booked: ${ctx.skipped}`);

  const failures = [];
  for (const r of rows) {
    const limit = r.name.startsWith('socket') ? TARGET.socketP95 : r.name.startsWith('sign in') ? TARGET.loginP95 : TARGET.restP95;
    if (r.p95 > limit) failures.push(`${r.name}: p95 ${r.p95.toFixed(0)} ms is over ${limit} ms`);
  }
  for (const [k, n] of errs) failures.push(`${k} x${n}`);
  if (dropped) failures.push(`${dropped} sockets dropped`);
  if (failures.length) { console.log('\nFAILED:\n - ' + failures.join('\n - ')); process.exitCode = 1; } else console.log('\nPASSED: all targets met.');
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  sockets.forEach((s) => s.close());
  stopServers();
  await cleanup(users);
  await prisma.$disconnect();
}
