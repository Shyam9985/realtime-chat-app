import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { get } from '../store/api.service';
import { APP_VERSION_CODE } from '../config';

/*
 * App updates without the Play Store. At start the app asks the server for the newest published build;
 * when there is one, YaapZone downloads the APK itself and hands it to Android, which asks the user
 * "Install update?" (Android never lets an app outside the store install silently). Only the installed
 * Android app takes part: Expo Go updates through the dev server instead.
 */
const APK_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;     // the installer may read our downloaded file

export const updatesSupported = () => Platform.OS === 'android' && !isRunningInExpoGo();

// "check now": a tapped "new version" notification, or that push arriving while the app is open.
// the update dialog listens (it lives in App.js, these callers do not know it)
const checkRequests = new Set();
export const onUpdateCheckRequested = (fn) => { checkRequests.add(fn); return () => checkRequests.delete(fn); };
export const requestUpdateCheck = () => checkRequests.forEach((fn) => fn());

// { latest: { version, version_code, apk_url, notes, is_mandatory }, update_available, mandatory } or null
export async function checkForUpdate() {
    if (!updatesSupported()) return null;
    const response = await get('app/latest', { version_code: APP_VERSION_CODE });
    return response?.data || null;
}

// downloads the release into the app's cache (progress 0..1, or null while the size is unknown), then
// opens android's installer on it. a previous attempt's file is simply overwritten
export async function downloadAndInstall(release, onProgress) {
    const apk = new File(Paths.cache, `yaapzone-${release.version}.apk`);
    await File.downloadFileAsync(release.apk_url, apk, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => onProgress?.(totalBytes > 0 ? bytesWritten / totalBytes : null),
    });
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: apk.contentUri, type: APK_TYPE, flags: FLAG_GRANT_READ_URI_PERMISSION });
}
