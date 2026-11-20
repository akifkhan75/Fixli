import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';
import { getAccessToken, refreshAccessToken } from './session';

/** What the server sends. Every event arrives wrapped: { id, type, occurredAt, data }. */
export type RealtimeType =
  | 'notification.created' | 'job.updated' | 'offers.updated' | 'feed.updated'
  | 'message.created' | 'message.read' | 'conversation.updated' | 'chat.typing';
export interface Envelope<T = any> { id: string; type: RealtimeType; occurredAt: string; data: T }
/** Local signals: 'resync' = we were offline and may have missed events, so reload. */
type LocalType = 'resync' | 'status';
type Listener = (e: Envelope) => void;
/** Sent by the server to the job's customer while the professional is on the way. */
export interface LocationUpdate { jobId: string; workerId: string; latitude: number; longitude: number; heading?: number; etaMinutes: number | null; at: string }
export type ConnectionStatus = 'offline' | 'connecting' | 'online';

const EVENTS: RealtimeType[] = ['notification.created', 'job.updated', 'offers.updated', 'feed.updated', 'message.created', 'message.read', 'conversation.updated', 'chat.typing'];

/**
 * One live connection per device (namespace /rt) for jobs, offers, notifications and, later, chat.
 *  - identity: the access token, re-read on every (re)connect; an expired token is refreshed once
 *  - reconnects on its own with backoff; when it comes back, emits 'resync' so screens reload
 *    whatever they show (events sent while offline are not replayed, the data is re-read instead)
 *  - de-duplicates by envelope id
 */
class RealtimeClient {
  private socket: Socket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private seen: string[] = [];
  private everReady = false;
  private refreshedForThisAttempt = false;
  status: ConnectionStatus = 'offline';

  private locationListeners: ((data: LocationUpdate) => void)[] = [];

  async connect() {
    this.disconnect();
    if (!(await getAccessToken())) return;
    this.everReady = false;
    this.setStatus('connecting');

    const socket = io(`${SOCKET_URL}/rt`, {
      // A function, so each reconnect sends the newest token.
      auth: (cb) => { void getAccessToken().then((token) => cb({ token })); },
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
    });
    this.socket = socket;

    socket.on('ready', () => {
      this.refreshedForThisAttempt = false;
      this.setStatus('online');
      if (this.everReady) this.fire('resync', { id: `resync-${Date.now()}`, type: 'resync' as any, occurredAt: new Date().toISOString(), data: null });
      this.everReady = true;
    });
    socket.on('error', (e: { code?: string }) => {
      if (e?.code === 'UNAUTHORIZED') void this.recoverAuth();
    });
    socket.on('disconnect', (reason) => {
      this.setStatus(reason === 'io client disconnect' ? 'offline' : 'connecting');
      // The server only hangs up on purpose (expired token, signed out): refresh and try once more.
      if (reason === 'io server disconnect') void this.recoverAuth();
    });
    socket.io.on('reconnect_attempt', () => this.setStatus('connecting'));

    for (const type of EVENTS) {
      socket.on(type, (env: Envelope) => {
        if (!env?.id || this.seen.includes(env.id)) return;
        this.seen.push(env.id);
        if (this.seen.length > 200) this.seen.shift();
        this.fire(type, env);
      });
    }

    socket.on('locationUpdate', (data: any) => this.locationListeners.forEach((l) => l(data)));
  }

  private async recoverAuth() {
    if (this.refreshedForThisAttempt || !this.socket) return;
    this.refreshedForThisAttempt = true;
    try {
      const token = await refreshAccessToken();
      if (token && this.socket) this.socket.connect(); // auth() re-reads the new token
      else this.disconnect(); // session is gone; the app is signing out
    } catch {
      // Offline: retry later.
      setTimeout(() => { this.refreshedForThisAttempt = false; this.socket?.connect(); }, 5000);
    }
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.io.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('offline');
  }

  on(type: RealtimeType | LocalType, fn: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => { this.listeners.get(type)?.delete(fn); };
  }

  private fire(type: string, env: Envelope) {
    this.listeners.get(type)?.forEach((fn) => { try { fn(env); } catch (e) { console.warn('realtime listener failed', e); } });
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.fire('status', { id: `status-${Date.now()}`, type: 'status' as any, occurredAt: new Date().toISOString(), data: s });
  }

  // ── typing & live location ─────────

  /** "I'm typing" (the server throttles and forwards it). Messages themselves go over REST + the outbox. */
  typing(threadId: string) {
    if (this.socket?.connected) this.socket.emit('typing', { threadId });
  }

  sendLocation(jobId: string, latitude: number, longitude: number, heading?: number) {
    if (this.socket?.connected) this.socket.emit('locationUpdate', { jobId, latitude, longitude, heading });
  }

  onLocationUpdate(callback: (data: LocationUpdate) => void) {
    this.locationListeners.push(callback);
    return () => { this.locationListeners = this.locationListeners.filter((l) => l !== callback); };
  }
}

export const realtime = new RealtimeClient();
/** Older name, kept for the location trackers. */
export const socketService = realtime;
