import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from './useRedux';
import { selectCurrentUser } from '../store/authSlice';
import { useLiveReload } from './useRealtime';
import * as api from '../services/api';

/**
 * Count of jobs the worker can act on now (feed matches + customers who chose them).
 * Used for the Jobs tab attention dot.
 */
export function useWorkerAvailableJobs() {
  const user = useAppSelector(selectCurrentUser);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setCount(0);
      return;
    }
    try {
      const [feed, asked] = await Promise.all([api.getWorkerFeed(), api.listJobs('AWAITING_WORKER')]);
      const choseMe = asked.items.filter((j) => j.assignedWorkerId === user.id).length;
      setCount(feed.length + choseMe);
    } catch {
      /* offline: keep last count */
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useLiveReload(refresh, ['feed.updated', 'job.updated', 'offers.updated']);

  return count;
}
