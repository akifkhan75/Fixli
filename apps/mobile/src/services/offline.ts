import AsyncStorage from '@react-native-async-storage/async-storage';

// Offline outbox (doc 27 R6). Anything that must not be lost when the network drops (a service
// request, a chat message) is stored here and sent later, exactly once: every item carries the
// idempotency key the server already dedupes on, so a retry after a half-finished send is safe.

/** Lower runs first, so a request is sent before the messages that talk about it. */
export const KIND_ORDER = { UPLOAD: 0, JOB: 1, OFFER: 2, MESSAGE: 3 } as const;
export type OutboxKind = keyof typeof KIND_ORDER;

export const BACKOFF_SECONDS = [5, 15, 45];
/** ASAP and emergency requests go stale quickly: after this we ask before sending. */
export const TTL_URGENT_MS = 20 * 60_000;
export const TTL_SCHEDULED_MS = 24 * 3_600_000;

export interface OutboxItem {
  /** The idempotency key (job `idempotencyKey`, message `clientId`, ...). Unique per user. */
  id: string;
  userId: string;
  kind: OutboxKind;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  body?: unknown;
  /** Short plain-language label for the "Still want to send?" prompt and the banner. */
  label: string;
  createdAt: number;
  validUntil: number;
  attempts: number;
  nextAttemptAt: number;
  /** Ids of items that must be delivered first. */
  dependsOn?: string[];
}

export type SendOutcome = 'sent' | 'retry' | 'rejected';
export type Sender = (item: OutboxItem) => Promise<SendOutcome>;

export interface KeyValueStore {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}

export interface FlushResult { sent: string[]; rejected: string[]; expired: OutboxItem[]; retrying: number }

const STORAGE_KEY = '@fixli_outbox_v1';

export function backoffMs(attempts: number): number {
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1 < 0 ? 0 : Math.min(attempts, BACKOFF_SECONDS.length) - 1] * 1000;
}

export class Outbox {
  private items: OutboxItem[] = [];
  private loaded = false;
  private flushing = false;
  private listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore, private readonly now: () => number = Date.now) {}

  private async load() {
    if (this.loaded) return;
    try {
      const raw = await this.store.getItem(STORAGE_KEY);
      this.items = raw ? JSON.parse(raw) : [];
    } catch {
      this.items = [];
    }
    this.loaded = true;
  }

  private async save() {
    await this.store.setItem(STORAGE_KEY, JSON.stringify(this.items));
    this.listeners.forEach((l) => l());
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  async list(userId?: string): Promise<OutboxItem[]> {
    await this.load();
    return this.items.filter((i) => !userId || i.userId === userId);
  }

  /** Add an item. Adding the same id again is a no-op, so a double tap cannot queue twice. */
  async enqueue(input: Omit<OutboxItem, 'createdAt' | 'validUntil' | 'attempts' | 'nextAttemptAt'> & { ttlMs: number }): Promise<OutboxItem> {
    await this.load();
    const existing = this.items.find((i) => i.id === input.id && i.userId === input.userId);
    if (existing) return existing;
    const { ttlMs, ...rest } = input;
    const t = this.now();
    const item: OutboxItem = { ...rest, createdAt: t, validUntil: t + ttlMs, attempts: 0, nextAttemptAt: t };
    this.items.push(item);
    await this.save();
    return item;
  }

  async remove(id: string, userId: string) {
    await this.load();
    this.items = this.items.filter((i) => !(i.id === id && i.userId === userId));
    await this.save();
  }

  /** The user chose "send anyway" for a stale item: give it a fresh window and try now. */
  async renew(id: string, userId: string, ttlMs: number) {
    await this.load();
    const it = this.items.find((i) => i.id === id && i.userId === userId);
    if (it) { it.validUntil = this.now() + ttlMs; it.nextAttemptAt = this.now(); await this.save(); }
  }

  async clear() {
    this.items = [];
    this.loaded = true;
    await this.store.removeItem(STORAGE_KEY);
    this.listeners.forEach((l) => l());
  }

  /** Make every waiting item due right now (used when the connection comes back). */
  async retryNow(userId: string) {
    await this.load();
    this.items.forEach((i) => { if (i.userId === userId) i.nextAttemptAt = 0; });
    await this.save();
  }

  /**
   * Send what is due, in dependency order. Stale items are not sent: they come back in `expired`
   * so the app can ask. Safe to call often; concurrent calls do nothing.
   */
  async flush(userId: string, send: Sender): Promise<FlushResult> {
    await this.load();
    const result: FlushResult = { sent: [], rejected: [], expired: [], retrying: 0 };
    if (this.flushing) return result;
    this.flushing = true;
    try {
      const mine = () => this.items.filter((i) => i.userId === userId)
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.createdAt - b.createdAt);
      const failedThisRound = new Set<string>();

      for (const item of mine()) {
        if (item.validUntil <= this.now()) { result.expired.push(item); continue; }
        if (item.nextAttemptAt > this.now()) { result.retrying++; continue; }
        // Wait for anything this depends on (still queued, or just failed to go out).
        const blocked = (item.dependsOn ?? []).some((d) => this.items.some((o) => o.id === d && o.userId === userId) || failedThisRound.has(d));
        if (blocked) { result.retrying++; continue; }

        let outcome: SendOutcome;
        try { outcome = await send(item); } catch { outcome = 'retry'; }

        if (outcome === 'sent') {
          this.items = this.items.filter((i) => i !== item);
          result.sent.push(item.id);
        } else if (outcome === 'rejected') {
          // The server said no (validation, forbidden, gone). Retrying cannot help.
          this.items = this.items.filter((i) => i !== item);
          result.rejected.push(item.id);
          failedThisRound.add(item.id);
        } else {
          item.attempts += 1;
          item.nextAttemptAt = this.now() + backoffMs(item.attempts);
          failedThisRound.add(item.id);
          result.retrying++;
        }
      }
      await this.save();
      return result;
    } finally {
      this.flushing = false;
    }
  }
}

export const outbox = new Outbox(AsyncStorage);
