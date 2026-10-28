/*
 * The signed-in user's profile photo, kept on this device only (nothing is uploaded).
 *  - phone: a file in the app's private documents folder, profile-photo-<userId>.jpg. Android keeps it
 *    under the app's internal storage (/data/data/com.yaapzone.app/files/...), outside the APK; it is
 *    removed when the app is uninstalled or its data is cleared, and other apps cannot read it.
 * One file per user id, so two accounts on the same phone keep their own photos.
 */
const nativeFile = (userId) => {
  const { File, Paths } = require('expo-file-system');
  return new File(Paths.document, `profile-photo-${userId}.jpg`);
};

// the stored photo's uri, or null. a version suffix makes <Image> reload after a change
export async function loadPhoto(userId) {
  if (!userId) return null;
  const file = nativeFile(userId);
  return file.exists ? `${file.uri}?v=${file.modificationTime || 0}` : null;
}

// copies a picked image into app storage, replacing any earlier photo; returns its new uri
export async function savePhoto(userId, pickedUri) {
  const { File } = require('expo-file-system');
  const file = nativeFile(userId);
  if (file.exists) file.delete();
  await new File(pickedUri).copy(file);
  return `${file.uri}?v=${Date.now()}`;
}
