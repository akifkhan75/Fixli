import { useCallback, useState } from 'react';
import { pickPhoto, type PhotoSource } from '../services/pickPhoto';
import { isOffline } from '../services/api';
import { uploadImage, type UploadPurpose } from '../services/upload';
import { friendlyError } from './useApi';

export interface Uploaded {
  id: string; url: string | null; localUri: string;
  /** Taken with no signal: kept on the phone, uploaded when the step is sent. `id` is empty. */
  pending?: boolean;
}

/** Pick (camera/gallery) -> shrink -> upload -> server verifies. Exposes busy/error for the screen. */
export function usePhotoUpload(purpose: UploadPurpose, opts: { square?: boolean; frontCamera?: boolean; keepIfOffline?: boolean } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [denied, setDenied] = useState(false);

  const run = useCallback(async (source: PhotoSource): Promise<Uploaded | null> => {
    setError(undefined);
    setDenied(false);
    try {
      const picked = await pickPhoto(source, opts);
      if ('cancelled' in picked) return null;
      if ('denied' in picked) {
        setDenied(true);
        setError(picked.denied);
        return null;
      }
      setBusy(true);
      try {
        const up = await uploadImage(picked.photo.uri, purpose, picked.photo.width);
        return { ...up, localUri: picked.photo.uri };
      } catch (e) {
        // No signal: keep the photo on the phone when the screen can send it later.
        if (opts.keepIfOffline && isOffline(e)) return { id: '', url: null, localUri: picked.photo.uri, pending: true };
        throw e;
      }
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [purpose, opts.square, opts.frontCamera, opts.keepIfOffline]);

  return { run, busy, error, denied };
}
