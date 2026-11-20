import { useEffect, useState } from 'react';
import { connectivity } from '../services/connectivity';
import { outbox, type OutboxItem } from '../services/outbox';

/** What is waiting on this phone for the signed-in person, and whether the phone is online. */
export function useOutbox(userId: string | undefined, group?: string) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(connectivity.online);

  useEffect(() => {
    if (!userId) { setItems([]); return undefined; }
    let alive = true;
    const refresh = () => { void outbox.list({ userId, group }).then((l) => { if (alive) setItems(l); }); };
    refresh();
    const off = outbox.subscribe(refresh);
    return () => { alive = false; off(); };
  }, [userId, group]);

  useEffect(() => { setOnline(connectivity.online); return connectivity.subscribe(setOnline); }, []);

  return {
    online,
    items,
    waiting: items.filter((i) => i.status === 'queued'),
    failed: items.filter((i) => i.status === 'failed'),
  };
}
