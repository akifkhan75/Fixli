import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import { t } from '../i18n';

export type PhotoSource = 'camera' | 'library';
export interface PickedPhoto { uri: string; width: number }
export type PickResult = { photo: PickedPhoto } | { cancelled: true } | { denied: string };

/**
 * Asks for the permission only when the user taps, and always returns something the screen can
 * explain: a photo, a cancel, or a plain-language reason the permission was refused.
 */
export async function pickPhoto(source: PhotoSource, opts: { square?: boolean; frontCamera?: boolean } = {}): Promise<PickResult> {
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return {
      denied: source === 'camera'
        ? t('photo.cameraOff')
        : t('photo.libraryOff'),
    };
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: !!opts.square,
    aspect: opts.square ? [1, 1] : undefined,
    quality: 1,
    cameraType: opts.frontCamera ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return { cancelled: true };
  return { photo: { uri: result.assets[0].uri, width: result.assets[0].width } };
}

export const openSettings = () => Linking.openSettings();
