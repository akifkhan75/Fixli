import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The last good answer for a few screens (catalogue, today's jobs, an open job), so the app
 * still shows something with no signal, labelled with when it was last updated (doc 27 F7.1).
 * It's only ever used when the phone is offline, never instead of asking the server, and it's
 * wiped at sign-out so nothing of one account is shown to the next.
 */
const PREFIX = '@fixli_cache:';

export interface Cached<T> { at: string; data: T }

export const readCache = async <T,>(key: string, storage: Pick<typeof AsyncStorage, 'getItem'> = AsyncStorage): Promise<Cached<T> | null> => {
  try {
    const raw = await storage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch { return null; }
};

export const writeCache = async <T,>(key: string, data: T, storage: Pick<typeof AsyncStorage, 'setItem'> = AsyncStorage) => {
  try { await storage.setItem(PREFIX + key, JSON.stringify({ at: new Date().toISOString(), data } satisfies Cached<T>)); } catch { /* a full disk just means no cache */ }
};

export const clearCache = async (storage: Pick<typeof AsyncStorage, 'getAllKeys' | 'multiRemove'> = AsyncStorage) => {
  try {
    const keys = (await storage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await storage.multiRemove(keys);
  } catch { /* nothing to clear */ }
};
