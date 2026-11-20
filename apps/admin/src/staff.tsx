import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as api from './api';
import { useAuth } from './auth';

type FeedKind = 'verification' | 'dispute' | 'incident' | 'settlement';
interface StaffValue {
  me: api.Me | null;
  can: (permission: string) => boolean;
  /** New items since you last opened that page (from the live staff feed). */
  badges: Record<FeedKind, number>;
  clearBadge: (k: FeedKind) => void;
  toasts: { id: string; text: string; to: string }[];
  dismissToast: (id: string) => void;
  live: boolean;
  /** Goes up each time the live connection comes back: pages reload so nothing sent while offline is missed. */
  resync: number;
}
const Ctx = createContext<StaffValue | null>(null);

const EVENTS: Record<string, { kind: FeedKind; text: string; to: string }> = {
  'staff.verification_submitted': { kind: 'verification', text: 'New document to check', to: '/verifications' },
  'staff.dispute_opened': { kind: 'dispute', text: 'A new dispute was opened', to: '/disputes' },
  'staff.incident_reported': { kind: 'incident', text: 'New safety incident', to: '/safety' },
  'staff.settlement_reported': { kind: 'settlement', text: 'A worker reported a payment', to: '/finance' },
};

/**
 * Who the signed-in staff member is and what they may do (the server decides; the menu just
 * hides what would be refused), plus the live staff feed over the same authenticated /rt
 * connection the apps use. The server only sends each person the feeds their roles allow.
 */
export function StaffProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [me, setMe] = useState<api.Me | null>(null);
  const [badges, setBadges] = useState<Record<FeedKind, number>>({ verification: 0, dispute: 0, incident: 0, settlement: 0 });
  const [toasts, setToasts] = useState<{ id: string; text: string; to: string }[]>([]);
  const [live, setLive] = useState(false);
  const [resync, setResync] = useState(0);
  const socket = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) { setMe(null); return; }
    // No roles (or a refused call) = no permissions: the menu explains, rather than spinning forever.
    api.getMe().then(setMe).catch(() => setMe({ id: user.id, name: user.name, email: user.email, adminRoles: [], permissions: [], totpEnabledAt: null }));
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const origin = (api.API_BASE ?? '').replace(/\/api(\/v\d+)?$/, '');
    const s = io(`${origin}/rt`, {
      auth: (cb) => { void api.liveToken().then((token) => cb({ token })); },
      transports: ['websocket'],
      reconnectionDelayMax: 30_000,
    });
    socket.current = s;
    let seen = false;
    s.on('ready', () => { setLive(true); if (seen) setResync((n) => n + 1); seen = true; });
    s.on('disconnect', () => setLive(false));
    for (const [event, meta] of Object.entries(EVENTS)) {
      s.on(event, (env: { id: string }) => {
        setBadges((b) => ({ ...b, [meta.kind]: b[meta.kind] + 1 }));
        setToasts((t) => [...t.slice(-3), { id: env?.id ?? String(Date.now()), text: meta.text, to: meta.to }]);
      });
    }
    return () => { s.removeAllListeners(); s.disconnect(); socket.current = null; setLive(false); };
  }, [user]);

  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  const clearBadge = useCallback((k: FeedKind) => setBadges((b) => ({ ...b, [k]: 0 })), []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return <Ctx.Provider value={{ me, can, badges, clearBadge, toasts, dismissToast, live, resync }}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStaff must be inside StaffProvider');
  return v;
}
