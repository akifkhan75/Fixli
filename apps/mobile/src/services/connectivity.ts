import NetInfo from '@react-native-community/netinfo';

type Listener = (online: boolean) => void;

/**
 * Whether the phone has a usable connection right now (`isInternetReachable` is null while the
 * phone is still checking; that counts as online, so we try rather than refuse).
 * Used for the "Offline" bar and to flush the outbox the moment the connection returns.
 */
export class Connectivity {
  online = true;
  private listeners = new Set<Listener>();
  private stop: (() => void) | null = null;

  start() {
    if (this.stop) return this.stop;
    this.stop = NetInfo.addEventListener((s) => {
      const next = s.isConnected !== false && s.isInternetReachable !== false;
      if (next === this.online) return;
      this.online = next;
      this.listeners.forEach((l) => l(next));
    });
    return () => { this.stop?.(); this.stop = null; };
  }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
}

export const connectivity = new Connectivity();
