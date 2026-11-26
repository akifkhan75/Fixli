import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from './api';

// While the app is open we show our own in-app banner (plus our own beep) instead of the system banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

let channelsReady = false;
async function ensureChannels() {
  if (Platform.OS !== 'android' || channelsReady) return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Updates', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 250],
  });
  await Notifications.setNotificationChannelAsync('requests', {
    name: 'New job requests', importance: Notifications.AndroidImportance.MAX, sound: 'default', vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 180],
  });
  channelsReady = true;
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
}

export type PushState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/**
 * Registers this device for push. With `ask: false` it only registers if permission was already
 * given; call with `ask: true` at a moment the user understands why (after sending a request,
 * when going online), never on first launch.
 */
export async function setupPush(ask: boolean): Promise<PushState> {
  try {
    await ensureChannels();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return status === 'denied' ? 'denied' : 'undetermined';
    const id = projectId();
    if (!id) {
      // Needs an EAS project (docs/25 O14). In-app notifications still work.
      console.warn('Push disabled: no EAS projectId in app config');
      return 'unavailable';
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await registerPushToken(data);
    return 'granted';
  } catch (e) {
    console.warn('Push setup failed', e);
    return 'unavailable';
  }
}

export const setAppBadge = (n: number) => Notifications.setBadgeCountAsync(n).catch(() => false);
