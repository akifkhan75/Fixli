import * as ImageManipulator from 'expo-image-manipulator';
import { File, UploadType } from 'expo-file-system';
import { API_URL } from '../config';
import { ApiError, createUploadSlot, completeUpload } from './api';
import { t } from '../i18n';

export type UploadPurpose = 'AVATAR' | 'VERIFICATION' | 'PORTFOLIO' | 'JOB_PHOTO' | 'CHAT_PHOTO';

const MAX_EDGE: Record<UploadPurpose, number> = { AVATAR: 800, PORTFOLIO: 1600, VERIFICATION: 2000, JOB_PHOTO: 1600, CHAT_PHOTO: 1600 };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '10.0.2.2', '0.0.0.0']);

/**
 * Local storage hands back signed PUT URLs built from PUBLIC_API_URL (often localhost), which a
 * physical device cannot reach. Point those at the same host the app already uses for the API.
 */
export function resolveUploadUrl(url: string): string {
  try {
    const target = new URL(url);
    const api = new URL(API_URL);
    if (LOOPBACK.has(target.hostname) && !LOOPBACK.has(api.hostname)) {
      target.protocol = api.protocol;
      target.hostname = api.hostname;
      target.port = api.port;
    }
    return target.toString();
  } catch {
    return url;
  }
}

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
 * RN's `fetch(fileUri).blob()` is unreliable on Expo SDK 58 (we saw 14-byte "photos" that
 * failed magic-byte checks). Stream the real file with expo-file-system instead.
 */
async function putLocalFile(url: string, fileUri: string, headers: Record<string, string>, failMessage: string): Promise<number> {
  const file = new File(fileUri);
  if (!file.exists || !file.size || file.size < 1) {
    throw new ApiError(failMessage, 0);
  }
  const result = await file.upload(resolveUploadUrl(url), {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    mimeType: headers['Content-Type'] ?? headers['content-type'],
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(failMessage, result.status);
  }
  return file.size;
}

/**
 * Photo -> object storage, in three steps: ask for a slot, PUT the bytes straight to storage,
 * then ask the server to verify them. The server decides if the file is acceptable.
 */
export async function uploadImage(uri: string, purpose: UploadPurpose, width?: number): Promise<{ id: string; url: string | null }> {
  const prepared = await prepareImage(uri, purpose, width);
  const file = new File(prepared);
  if (!file.exists || !file.size || file.size < 1) {
    throw new ApiError(t('photo.uploadFailed'), 0);
  }

  const slot = await createUploadSlot(purpose, 'image/jpeg', file.size);
  await putLocalFile(slot.upload.url, prepared, slot.upload.headers, t('photo.uploadFailed'));

  const done = await completeUpload(slot.id);
  return { id: done.id, url: done.url };
}

/** A finished voice recording (m4a) -> storage, verified by the server like photos. */
export async function uploadAudio(uri: string): Promise<{ id: string }> {
  const file = new File(uri);
  if (!file.exists || !file.size || file.size < 1) {
    throw new ApiError(t('photo.recordingUploadFailed'), 0);
  }
  const slot = await createUploadSlot('JOB_AUDIO', 'audio/mp4', file.size);
  await putLocalFile(slot.upload.url, uri, slot.upload.headers, t('photo.recordingUploadFailed'));
  const done = await completeUpload(slot.id);
  return { id: done.id };
}
