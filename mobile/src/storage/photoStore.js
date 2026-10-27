import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * The signed-in user's profile photo, kept on this device only (nothing is uploaded).
 *  - phone: a file in the app's private documents folder, profile-photo-<userId>.jpg. Android keeps it
 *    under the app's internal storage (/data/data/com.chatapp.mobile/files/...), outside the APK; it is
 *    removed when the app is uninstalled or its data is cleared, and other apps cannot read it.
 *  - browser build: a data URI in local storage.
 * One file per user id, so two accounts on the same phone keep their own photos.
 */
const webKey = (userId) => `chat-app.profile-photo.${userId}`;

const nativeFile = (userId) => {
  const { File, Paths } = require('expo-file-system');
  return new File(Paths.document, `profile-photo-${userId}.jpg`);
};

const toDataUri = async (uri) => {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// the stored photo's uri, or null. a version suffix makes <Image> reload after a change
export async function loadPhoto(userId) {
  if (!userId) return null;
  if (Platform.OS === 'web') return AsyncStorage.getItem(webKey(userId)).catch(() => null);
  const file = nativeFile(userId);
  return file.exists ? `${file.uri}?v=${file.modificationTime || 0}` : null;
}

// copies a picked image into app storage, replacing any earlier photo; returns its new uri
export async function savePhoto(userId, pickedUri) {
  if (Platform.OS === 'web') {
    const dataUri = await toDataUri(pickedUri);
    await AsyncStorage.setItem(webKey(userId), dataUri);
    return dataUri;
  }
  const { File } = require('expo-file-system');
  const file = nativeFile(userId);
  if (file.exists) file.delete();
  await new File(pickedUri).copy(file);
  return `${file.uri}?v=${Date.now()}`;
}
