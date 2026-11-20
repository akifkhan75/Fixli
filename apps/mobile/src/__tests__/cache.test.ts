jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { clearCache, readCache, writeCache } from '../services/cache';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, getAllKeys: async () => [...m.keys()], multiRemove: async (ks: readonly string[]) => { ks.forEach((k) => m.delete(k)); } };
};

describe('cache', () => {
  it('keeps the last answer with the time it was saved', async () => {
    const s = mem();
    await writeCache('job:1', { status: 'ARRIVED' }, s as any);
    const c = await readCache<{ status: string }>('job:1', s as any);
    expect(c?.data).toEqual({ status: 'ARRIVED' });
    expect(new Date(c!.at).getTime()).toBeGreaterThan(Date.now() - 5_000);
    expect(await readCache('job:2', s as any)).toBeNull();
  });

  it('sign-out wipes the cache and nothing else', async () => {
    const s = mem();
    await writeCache('catalog', [1], s as any);
    await s.setItem('@fixli_theme', 'dark');
    await clearCache(s as any);
    expect([...s.m.keys()]).toEqual(['@fixli_theme']);
  });

  it('a broken or full store never throws into a screen', async () => {
    const bad = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('full'); } };
    await expect(writeCache('k', 1, bad as any)).resolves.toBeUndefined();
    expect(await readCache('k', bad as any)).toBeNull();
  });
});
