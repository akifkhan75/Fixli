import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// One OS subscription for the whole app: every tappable asks, so it must be cheap.
let reduce = false;
let started = false;
const listeners = new Set<() => void>();

function set(value: boolean) {
  if (value === reduce) return;
  reduce = value;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    AccessibilityInfo.isReduceMotionEnabled()?.then(set).catch(() => undefined);
    AccessibilityInfo.addEventListener('reduceMotionChanged', set);
  }
  return () => { listeners.delete(listener); };
}

/** True when the person has turned on "Reduce motion" in the phone's accessibility settings. */
export function useReduceMotion() {
  return useSyncExternalStore(subscribe, () => reduce);
}
