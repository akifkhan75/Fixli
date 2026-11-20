import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { ApiError, isOffline } from './api';
import { connectivity } from './connectivity';
import { realtime } from './socket';

/**
 * Things the person did while the phone had no signal (a job step, a new request): saved on the
 * phone, then sent in order when the connection is back (doc 27 F7.1). Chat has its own outbox
 * (services/chatOutbox.ts) with the same rules.
 *
 *  - Each item has a stable id that is also its idempotency key, so a retry after a timeout or an
 *    app restart can't do the thing twice (the server returns the original / treats a repeat as done).
 *  - Order is kept per `group` (one job): a later step never overtakes an earlier one.
 *  - No connection / server trouble: kept, retried with backoff (2 s, 4 s ... up to 1 min), and at
 *    once when the connection returns, the app opens, or the live connection resyncs.
 *  - The server says no (4xx other than 408/429): marked "failed" and shown to the person; never
 *    retried silently forever.
 */
export type OutboxKind = 'job_action' | 'job_request';

export interface OutboxItem<P = any> {
  id: string;
  kind: OutboxKind;
  /** Whose it is: signing out removes only/all of this account's items. */
  userId: string;
  /** Items in one group are sent in order; a failed one holds back the rest of its group. */
  group: string;
  payload: P;
  status: 'queued' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  createdAt: string;
}

export interface OutboxHandler<P = any> {
  /** Do it. Throw ApiError for server answers; anything with code OFFLINE is retried. */
  send(payload: P, ctx: { id: string; patch: (changes: Partial<P>) => Promise<void> }): Promise<unknown>;
  /** A server "no" may mean it already worked (a repeat): return true to treat it as done. */
  alreadyDone?(payload: P, error: ApiError, item: OutboxItem<P>): Promise<boolean>;
  /** Short plain-language name for the screen, e.g. "I'm on my way". */
  describe(payload: P): string;
}

type Event = { type: 'changed' } | { type: 'sent'; item: OutboxItem; result: unknown };

const KEY = '@fixli_outbox';
const BASE_DELAY = 2_000;
const MAX_DELAY = 60_000;

export const newOutboxId = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
export const backoffMs = (attempts: number) => Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.max(0, attempts - 1));

/** A server answer that won't change by retrying (4xx except timeouts and rate limits). */
export const isPermanent = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

export class Outbox {
  private items: OutboxItem[] = [];
  private loaded: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private disposed = false;
  private skipWait = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(e: Event) => void>();

  constructor(
    private readonly handlers: Partial<Record<OutboxKind, OutboxHandler>> = {},
    private readonly storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage,
    private readonly now: () => number = Date.now,
  ) {}

  register<P>(kind: OutboxKind, handler: OutboxHandler<P>) { this.handlers[kind] = handler as OutboxHandler; }

  private load() {
    this.loaded ??= this.storage.getItem(KEY).then((raw) => { this.items = raw ? JSON.parse(raw) : []; }).catch(() => { this.items = []; });
    return this.loaded;
  }
  private async save() {
    await this.storage.setItem(KEY, JSON.stringify(this.items)).catch(() => undefined);
    this.emit({ type: 'changed' });
  }
  private emit(e: Event) { this.listeners.forEach((l) => l(e)); }

  subscribe(fn: (e: Event) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  async list(filter?: { userId?: string; group?: string; kind?: OutboxKind }) {
    await this.load();
    return this.items.filter((i) => (!filter?.userId || i.userId === filter.userId) && (!filter?.group || i.group === filter.group) && (!filter?.kind || i.kind === filter.kind));
  }

  describe(item: OutboxItem) { return this.handlers[item.kind]?.describe(item.payload) ?? item.kind; }

  async add<P>(kind: OutboxKind, userId: string, group: string, payload: P, id = newOutboxId()) {
    await this.load();
    if (this.items.some((i) => i.id === id)) return id;
    this.items.push({ id, kind, userId, group, payload, status: 'queued', attempts: 0, nextAttemptAt: 0, createdAt: new Date(this.now()).toISOString() });
    await this.save();
    void this.flush();
    return id;
  }

  async retry(id: string) {
    await this.load();
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    it.status = 'queued'; it.error = undefined; it.attempts = 0; it.nextAttemptAt = 0;
    await this.save();
    void this.flush();
  }

  async discard(id: string) {
    await this.load();
    this.items = this.items.filter((i) => i.id !== id);
    await this.save();
    void this.flush(); // a held-back item behind it can go now
  }

  /** Signing out: nothing of this account stays on the phone. */
  async clear(userId?: string) {
    await this.load();
    this.items = userId ? this.items.filter((i) => i.userId !== userId) : [];
    if (!this.items.length) await this.storage.removeItem(KEY).catch(() => undefined);
    else await this.save();
    this.emit({ type: 'changed' });
  }

  /**
   * Send what's due, in order. `now: true` (connection back, app reopened) ignores the backoff wait.
   * Calls while a run is in progress join it, and anything added meanwhile is picked up before it ends.
   */
  flush(opts: { now?: boolean } = {}): Promise<void> {
    if (opts.now) this.skipWait = true;
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        await this.load(); // the saved items must be in memory before we touch their waits
        do {
          this.again = false;
          if (this.skipWait) {
            this.skipWait = false;
            this.items.forEach((i) => { if (i.status === 'queued') i.nextAttemptAt = 0; });
          }
          await this.runOnce();
        } while (this.again);
      } finally {
        // Cleared in the same tick as the last check: a flush() can't slip in between and be lost.
        this.running = null;
        this.schedule();
      }
    })();
    return this.running;
  }

  private schedule() {
    if (this.disposed) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const due = this.items.filter((i) => i.status === 'queued').map((i) => i.nextAttemptAt);
    if (!due.length) return;
    const wait = Math.max(500, Math.min(...due) - this.now());
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, wait);
  }

  private async runOnce() {
    // The phone already knows it has no connection: don't try (and don't burn the backoff); the next
    // connectivity change flushes.
    if (!connectivity.online) return;
    const blocked = new Set<string>(); // groups with an item that is failed or waiting to retry
    for (const it of [...this.items]) {
      if (!this.items.includes(it)) continue;
      if (it.status === 'failed') { blocked.add(it.group); continue; }
      if (blocked.has(it.group)) continue;
      if (it.nextAttemptAt > this.now()) { blocked.add(it.group); continue; }
      const handler = this.handlers[it.kind];
      if (!handler) continue;
      try {
        const result = await handler.send(it.payload, { id: it.id, patch: async (c) => { it.payload = { ...it.payload, ...c }; await this.save(); } });
        await this.finish(it, result);
      } catch (e) {
        if (isPermanent(e)) {
          if (handler.alreadyDone && (await handler.alreadyDone(it.payload, e as ApiError, it).catch(() => false))) { await this.finish(it, null); continue; }
          it.status = 'failed';
          it.error = e instanceof ApiError ? e.userMessage : (e as Error).message;
          blocked.add(it.group);
          await this.save();
        } else {
          // Offline, or the server is struggling: wait (backoff) and keep this group's order.
          it.attempts += 1;
          it.nextAttemptAt = this.now() + backoffMs(it.attempts);
          if (!isOffline(e)) it.error = (e as Error).message;
          blocked.add(it.group);
          await this.save();
        }
      }
    }
  }

  private async finish(it: OutboxItem, result: unknown) {
    this.items = this.items.filter((x) => x.id !== it.id);
    await this.save();
    this.emit({ type: 'sent', item: it, result });
  }

  /** Stop the retry timer (tests, hot reload). */
  dispose() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.disposed = true; }

  /** Send when the connection comes back, the app is reopened, or the live connection resyncs. */
  start() {
    const offs = [
      connectivity.subscribe((online) => { if (online) void this.flush({ now: true }); }),
      realtime.on('resync', () => void this.flush({ now: true })),
    ];
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void this.flush({ now: true }); });
    void this.flush({ now: true });
    return () => { offs.forEach((o) => o()); sub.remove(); if (this.timer) clearTimeout(this.timer); this.timer = null; };
  }
}

export const outbox = new Outbox();
