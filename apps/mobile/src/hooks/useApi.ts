import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isOffline } from '../services/api';
import { readCache, writeCache } from '../services/cache';
import { t } from '../i18n';

export interface ApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => Promise<void>;
  setData: (d: T | undefined) => void;
  /** Set when the phone is offline and `data` is the last saved answer from this time. */
  staleAt: string | undefined;
}

/** Plain-language message for any failure; never a raw exception string. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.userMessage;
  return t('common.noServer');
}

/**
 * Loads data once (and on `reload`), tracking loading + error. Screens render the three states
 * (loading / error with retry / data or empty); they never fall back to fake data.
 */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = [], opts: { cacheKey?: string } = {}): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [staleAt, setStaleAt] = useState<string | undefined>(undefined);
  const alive = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(opts.cacheKey);
  keyRef.current = opts.cacheKey;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await loadRef.current();
      if (alive.current) { setData(result); setStaleAt(undefined); }
      if (keyRef.current) void writeCache(keyRef.current, result);
    } catch (e) {
      // No signal: show what we last had, labelled, rather than an empty error screen.
      const cached = keyRef.current && isOffline(e) ? await readCache<T>(keyRef.current) : null;
      if (cached) { if (alive.current) { setData(cached.data); setStaleAt(cached.at); } }
      else if (alive.current) setError(friendlyError(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload, setData, staleAt };
}
