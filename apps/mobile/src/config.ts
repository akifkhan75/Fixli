import Constants from 'expo-constants';

const envApiUrl = process.env.EXPO_PUBLIC_API_URL;

function resolveApiUrl(): string {
  if (!envApiUrl) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to apps/mobile/.env and set it.',
    );
  }

  // In development, automatically align local/private IP with Metro host if running on physical device or simulator
  if (__DEV__ && Constants.expoConfig?.hostUri) {
    const debuggerHost = Constants.expoConfig.hostUri.split(':')[0];
    if (debuggerHost) {
      return envApiUrl.replace(
        /(https?:\/\/)(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?/,
        `$1${debuggerHost}$3`,
      );
    }
  }

  return envApiUrl;
}

export const API_URL = resolveApiUrl().replace(/\/+$/, '');
// Socket.IO lives on the server origin, not under the /api prefix.
export const SOCKET_URL = API_URL.replace(/\/api(\/v\d+)?$/, '');
