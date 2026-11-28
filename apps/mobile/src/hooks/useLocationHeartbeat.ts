import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as api from '../services/api';

const EVERY_MS = 90_000;

/**
 * While `enabled` (the worker is online) and the app is in the foreground, report the worker's
 * position so roadside / immediate requests can match them from where they actually are, not just
 * their home service area. Foreground-only and best-effort: it never prompts for permission and
 * silently ignores failures (matching falls back to the base location). Background tracking is a
 * separate, future piece of work.
 */
export function useLocationHeartbeat(enabled: boolean): void {
  const cancelled = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    cancelled.current = false;

    const tick = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
        ]).catch(() => null);
        const pos = fresh ?? (await Location.getLastKnownPositionAsync().catch(() => null));
        if (!pos || cancelled.current) return;
        await api.reportWorkerLocation(pos.coords.latitude, pos.coords.longitude).catch(() => undefined);
      } catch {
        /* best-effort heartbeat */
      }
    };

    void tick();
    const timer = setInterval(tick, EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void tick(); });
    return () => {
      cancelled.current = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled]);
}
