import { useCallback } from 'react';
import { router } from 'expo-router';
import type { WorkerMe } from '../services/api';
import { haptic } from '../components/motion/PressableScale';

/**
 * After a setup step is saved, go straight to the next unfinished one, so nobody has to find their
 * way through a menu. Editing a finished profile just goes back.
 */
export function useSetupNext() {
  return useCallback((me: WorkerMe) => {
    haptic('medium');
    const next = me.onboarding.missing[0];
    if (me.activationStatus === 'ONBOARDING' && next) router.replace(`/setup/${next}` as any);
    else router.back();
  }, []);
}
