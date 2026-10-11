import React, { useEffect, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import * as api from '../../services/api';

let cache: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;
const load = () => {
  if (cache) return Promise.resolve(cache);
  loading ??= api.getFavorites().then((f) => (cache = new Set(f.map((x) => x.workerId)))).catch(() => new Set<string>()).finally(() => { loading = null; });
  return loading;
};
export const forgetFavorites = () => { cache = null; };

/** Save a professional to book again later. */
export function FavoriteHeart({ workerId, size = 26 }: { workerId: string; size?: number }) {
  const theme = useTheme();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void load().then((s) => alive && setOn(s.has(workerId))); return () => { alive = false; }; }, [workerId]);
  const toggle = async () => {
    setBusy(true);
    const next = !on;
    setOn(next);
    try {
      if (next) { await api.addFavorite(workerId); cache?.add(workerId); } else { await api.removeFavorite(workerId); cache?.delete(workerId); }
    } catch { setOn(!next); } finally { setBusy(false); }
  };
  return (
    <TouchableOpacity onPress={toggle} disabled={busy} accessibilityRole="button" accessibilityLabel={on ? 'Remove from favourites' : 'Save to favourites'} accessibilityState={{ selected: on }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Ionicons name={on ? 'heart' : 'heart-outline'} size={size} color={on ? theme.colors.error : theme.colors.textTertiary} />
    </TouchableOpacity>
  );
}
