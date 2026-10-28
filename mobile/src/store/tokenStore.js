import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/*
 * The access token lives in the device keychain / keystore. The user object is not secret and
 * goes to async storage.
 */
const TOKEN_KEY = 'yaapzone.access-token';
const USER_KEY = 'yaapzone.user';

export async function getToken() {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch (_) {
    return null;
  }
}

export async function setToken(token) {
  try {
    if (!token) return clearToken();
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (_) { /* a failed save only means the next launch asks for login again */ }
}

export async function clearToken() {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
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
