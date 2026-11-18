import { Alert, AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { outbox, TTL_URGENT_MS, TTL_SCHEDULED_MS, type OutboxItem } from './offline';
import { sendQueued } from './api';

const TICK_MS = 15_000;
let started: { userId: string; stop: () => void } | null = null;
let asking = false;

/** "Still want to send?" for requests that waited too long. One question at a time. */
function askAboutStale(userId: string, stale: OutboxItem[]) {
  if (asking || stale.length === 0) return;
  asking = true;
  const [item, ...rest] = stale;
  const next = () => { asking = false; askAboutStale(userId, rest); };
  Alert.alert(
    'Still want to send?',
    `${item.label} was saved while you were offline and has been waiting a while.`,
    [
      { text: 'Discard', style: 'destructive', onPress: () => { void outbox.remove(item.id, userId).then(next); } },
      { text: 'Send now', onPress: () => { void outbox.renew(item.id, userId, item.kind === 'JOB' ? TTL_URGENT_MS : TTL_SCHEDULED_MS).then(() => { void flushOutbox(userId); next(); }); } },
    ],
    { cancelable: false },
  );
}

export async function flushOutbox(userId: string) {
  const r = await outbox.flush(userId, sendQueued);
  askAboutStale(userId, r.expired);
  return r;
}

/** Delivers queued work whenever it can: connection back, app foregrounded, and on a slow timer. */
export function startOutbox(userId: string): () => void {
  if (started?.userId === userId) return started.stop;
  started?.stop();
  const run = () => { void flushOutbox(userId).catch(() => undefined); };
  const unNet = NetInfo.addEventListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void outbox.retryNow(userId).then(run);
  });
  const sub = AppState.addEventListener('change', (st) => { if (st === 'active') run(); });
  const timer = setInterval(run, TICK_MS);
  run();
  const stop = () => { unNet(); sub.remove(); clearInterval(timer); if (started?.userId === userId) started = null; };
  started = { userId, stop };
  return stop;
}
