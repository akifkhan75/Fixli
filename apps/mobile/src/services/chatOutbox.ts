import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { ApiError, sendChatMessage, type ChatMessage } from './api';
import { realtime } from './socket';

/**
 * Chat messages are written to this outbox first (persisted on the phone), then sent in order.
 * Each has a clientId, so a retry after a timeout or an app restart can never send twice; the
 * server returns the original message (doc 27 F4.4 / F7.1).
 *  - network trouble: kept "sending", retried when the connection comes back / app reopens
 *  - the server says no (closed chat, blocked, bad photo): marked "not sent", tap to retry
 */
export interface OutboxItem {
  clientId: string;
  conversationId: string;
  senderId: string;
  text?: string;
  imageUploadId?: string;
  localImageUri?: string;
  createdAt: string;
  status: 'sending' | 'failed';
  error?: string;
}
type Event = { type: 'changed' } | { type: 'sent'; clientId: string; message: ChatMessage & { warning?: 'CONTACT_INFO' } };

const KEY = '@fixli_chat_outbox';

export const newClientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A server answer that won't change by retrying (anything 4xx except timeouts and rate limits). */
const isPermanent = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

export class ChatOutbox {
  private items: OutboxItem[] = [];
  private loaded: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private listeners = new Set<(e: Event) => void>();

  constructor(private readonly send = sendChatMessage, private readonly storage = AsyncStorage) {}

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

  async list(conversationId: string) {
    await this.load();
    return this.items.filter((i) => i.conversationId === conversationId);
  }

  async add(item: Omit<OutboxItem, 'status' | 'createdAt'>) {
    await this.load();
    this.items.push({ ...item, status: 'sending', createdAt: new Date().toISOString() });
    await this.save();
    void this.flush();
  }

  async retry(clientId: string) {
    await this.load();
    const it = this.items.find((i) => i.clientId === clientId);
    if (!it) return;
    it.status = 'sending';
    it.error = undefined;
    await this.save();
    void this.flush();
  }

  async discard(clientId: string) {
    await this.load();
    this.items = this.items.filter((i) => i.clientId !== clientId);
    await this.save();
  }

  /** Signing out: nothing of this account stays on the phone. */
  async clear() {
    this.items = [];
    this.loaded = Promise.resolve();
    await this.storage.removeItem(KEY).catch(() => undefined);
  }

  /**
   * Send everything waiting, in order. Calls while a run is in progress join it, and anything
   * added meanwhile is picked up before it finishes.
   */
  flush(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      await this.load();
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async runOnce() {
    for (const it of [...this.items]) {
      if (it.status !== 'sending') continue;
      try {
        const message = await this.send(it.conversationId, { clientId: it.clientId, ...(it.text ? { text: it.text } : {}), ...(it.imageUploadId ? { imageUploadId: it.imageUploadId } : {}) });
        this.items = this.items.filter((x) => x.clientId !== it.clientId);
        await this.save();
        this.emit({ type: 'sent', clientId: it.clientId, message });
      } catch (e) {
        if (isPermanent(e)) {
          it.status = 'failed';
          it.error = (e as Error).message;
          await this.save();
        } else {
          this.again = false; // offline / server unreachable: keep order, try again later
          return;
        }
      }
    }
  }

  /** Retry when the connection comes back or the app is reopened. */
  start() {
    const offs = [
      realtime.on('resync', () => void this.flush()),
      realtime.on('status' as any, (e) => { if (e.data === 'online') void this.flush(); }),
    ];
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void this.flush(); });
    void this.flush();
    return () => { offs.forEach((o) => o()); sub.remove(); };
  }
}

export const chatOutbox = new ChatOutbox();
