import { useEffect, useState } from 'react';
import { realtime } from '../services/socket';
import * as api from '../services/api';

/**
 * Customer side of live tracking: the professional's position while they are on the way, from
 * the server (last known on open, then live updates). The customer's own location is never read.
 */
export function useWorkerLiveLocation(jobId: string, enabled: boolean) {
  const [location, setLocation] = useState<api.LiveLocation | null>(null);
  useEffect(() => {
    if (!enabled) { setLocation(null); return undefined; }
    let alive = true;
    api.getJobLocation(jobId).then((r) => { if (alive && r.location) setLocation(r.location); }).catch(() => undefined);
    const off = realtime.onLocationUpdate((d) => { if (d.jobId === jobId) setLocation(d); });
    return () => { alive = false; off(); };
  }, [jobId, enabled]);
  return location;
}
