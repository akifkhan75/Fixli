import * as ImageManipulator from 'expo-image-manipulator';
import { ApiError, createUploadSlot, completeUpload } from './api';
import { t } from '../i18n';

export type UploadPurpose = 'AVATAR' | 'VERIFICATION' | 'PORTFOLIO' | 'JOB_PHOTO' | 'CHAT_PHOTO';

const MAX_EDGE: Record<UploadPurpose, number> = { AVATAR: 800, PORTFOLIO: 1600, VERIFICATION: 2000, JOB_PHOTO: 1600, CHAT_PHOTO: 1600 };

/** Shrinks a camera photo to a sensible size/quality before upload (phones shoot 5-10 MB). */
export async function prepareImage(uri: string, purpose: UploadPurpose, width?: number) {
  const edge = MAX_EDGE[purpose];
  const actions = width && width > edge ? [{ resize: { width: edge } }] : [];
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: purpose === 'VERIFICATION' ? 0.85 : 0.75,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/**
 * Photo -> object storage, in three steps: ask for a slot, PUT the bytes straight to storage,
 * then ask the server to verify them. The server decides if the file is acceptable.
 */
export async function uploadImage(uri: string, purpose: UploadPurpose, width?: number): Promise<{ id: string; url: string | null }> {
  const prepared = await prepareImage(uri, purpose, width);
  const blob = await (await fetch(prepared)).blob();

  const slot = await createUploadSlot(purpose, 'image/jpeg', blob.size);
  const put = await fetch(slot.upload.url, { method: slot.upload.method, headers: slot.upload.headers, body: blob });
  if (!put.ok) throw new ApiError(t('photo.uploadFailed'), put.status);

  const done = await completeUpload(slot.id);
  return { id: done.id, url: done.url };
}

/** A finished voice recording (m4a) -> storage, verified by the server like photos. */
export async function uploadAudio(uri: string): Promise<{ id: string }> {
  const blob = await (await fetch(uri)).blob();
  const slot = await createUploadSlot('JOB_AUDIO', 'audio/mp4', blob.size);
  const put = await fetch(slot.upload.url, { method: slot.upload.method, headers: slot.upload.headers, body: blob });
  if (!put.ok) throw new ApiError(t('photo.recordingUploadFailed'), put.status);
  const done = await completeUpload(slot.id);
  return { id: done.id };
}
