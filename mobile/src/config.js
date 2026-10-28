import Constants from 'expo-constants';

/*
 * Where the api lives. EXPO_PUBLIC_API_URL (mobile/.env) is inlined by Expo at build time.
 *
 * "localhost" on a phone is the phone itself. During development
 * Expo Go loads the app from the computer's dev server and reports that computer's address (hostUri,
 * e.g. 192.168.1.9:8081). The api runs on the same computer, so on a device a localhost url is pointed
 * at that address. Any other url (a real server) is used as it is, and so is a tunnel address, which
 * only forwards the dev server, not the api.
 */
const configured = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4200').replace(/\/+$/, '');

const devServerHost = () => {
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || '';
  const host = hostUri.split(':')[0];
  return host && !host.endsWith('.exp.direct') ? host : null;
};

const resolveApiUrl = () => {
  const local = configured.match(/^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i);
  const host = local ? devServerHost() : null;
  return host ? `${local[1]}${host}${local[3] || ''}${local[4] || ''}` : configured;
};

export const API_URL = resolveApiUrl();
export const API_PREFIX = '/apiv1';

// this build's version (app.json, raised by `npm run release:patch|minor|major`) and the whole number
// android compares between builds; the update check (coming) compares versionCode with the latest release
export const APP_VERSION = Constants.expoConfig?.version || '0.0.0';
export const APP_VERSION_CODE = Number(Constants.expoConfig?.android?.versionCode) || 0;

// shows in the terminal running `expo start`, so it is easy to see which server a phone talks to
if (__DEV__) console.log(`[config] api server: ${API_URL}`);
