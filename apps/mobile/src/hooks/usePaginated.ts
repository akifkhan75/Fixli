import { useCallback, useRef, useState } from 'react';
import type { Page } from '../services/api';
import { friendlyError, useApi } from './useApi';

/**
 * A cursor-paged list: the first page behaves like `useApi` (cached for offline use), and `more()`
 * appends the next one. Reloading starts again from the top.
 */
export function usePaginated<T extends { id: string }>(load: (cursor?: string) => Promise<Page<T>>, deps: unknown[] = [], opts: { cacheKey?: string } = {}) {
  const first = useApi(() => load(), deps, opts);
  const [extra, setExtra] = useState<{ after: Page<T>; items: T[]; cursor: string | null }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | undefined>();
  const busy = useRef(false);

  // Extra pages belong to the first page they followed; a reload makes them stale.
  const current = extra && extra.after === first.data ? extra : undefined;
  const cursor = current ? current.cursor : first.data?.nextCursor ?? null;
  const seen = new Set(first.data?.items.map((i) => i.id));
  const items = first.data ? [...first.data.items, ...(current?.items.filter((i) => !seen.has(i.id)) ?? [])] : undefined;

  const more = useCallback(async () => {
    const after = first.data;
    if (!after || !cursor || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await load(cursor);
      setExtra((prev) => ({ after, items: [...(prev?.after === after ? prev.items : []), ...page.items], cursor: page.nextCursor }));
    } catch (e) {
      setMoreError(friendlyError(e));
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [first.data, cursor, load]);

  return { items, loading: first.loading, error: first.error, staleAt: first.staleAt, reload: first.reload, more, hasMore: !!cursor, loadingMore, moreError };
}
