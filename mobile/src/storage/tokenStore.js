import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/*
 * The access token lives in the device keychain / keystore on ios and android. The web build
 * (used for development and ui testing) has no secure store, so it falls back to local storage.
 * The user object is not secret and always goes to async storage.
 */
const TOKEN_KEY = 'chat-app.access-token';
const USER_KEY = 'chat-app.user';
const secure = Platform.OS !== 'web';

export async function getToken() {
  try {
    return secure ? await SecureStore.getItemAsync(TOKEN_KEY) : await AsyncStorage.getItem(TOKEN_KEY);
  } catch (_) {
    return null;
  }
}

export async function setToken(token) {
  try {
    if (!token) return clearToken();
    if (secure) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (_) { /* a failed save only means the next launch asks for login again */ }
}

export async function clearToken() {
  try {
    if (secure) await SecureStore.deleteItemAsync(TOKEN_KEY);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (_) { /* ignore */ }
}

export async function getUser() {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export async function setUser(user) {
  try {
    if (!user) await AsyncStorage.removeItem(USER_KEY);
    else await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (_) { /* ignore */ }
}
