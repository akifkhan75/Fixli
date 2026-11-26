import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;
let modeReady = false;

async function ensureMode() {
  if (modeReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    modeReady = true;
  } catch {
    /* keep going — haptic still works */
  }
}

function getPlayer(): AudioPlayer | null {
  if (player) return player;
  try {
    player = createAudioPlayer(require('../../assets/sounds/notify.wav'));
    return player;
  } catch {
    return null;
  }
}

/** Short sound + haptic for every in-app notification toast. */
export async function playNotifyFeedback() {
  void ensureMode().then(() => {
    const p = getPlayer();
    if (!p) return;
    try {
      p.seekTo(0);
      p.play();
    } catch {
      /* ignore playback failures */
    }
  });
  try {
    if (Platform.OS !== 'web') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  } catch {
    /* ignore */
  }
}
