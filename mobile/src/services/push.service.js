import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { post } from '../store/api.service';

/*
 * Push notifications through Firebase Cloud Messaging, without Expo's push service: the phone's own
 * FCM token goes to our server, which sends through Firebase directly. Only the installed Android
 * app can receive pushes: Expo Go (since SDK 53) and the browser build have no FCM, so there every
 * function here quietly does nothing.
 */
const TOKEN_KEY = 'yaapzone.push-token';
export const CHANNEL_ID = 'messages';

export const pushSupported = () => Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
const supported = pushSupported;

// tell the server this phone is ours; keep the token so sign-out can withdraw exactly this one
const sendToken = async (token) => {
    await post('devices', { push_token: token, platform: 'android' });
    await AsyncStorage.setItem(TOKEN_KEY, token);
};

// at every start and sign-in: channel, permission, token. answers the token, or null when push is
// unavailable or the user said no (the app works the same, just without notifications)
export async function registerForPush() {
    if (!supported()) return null;
    // android 13+ shows the permission prompt only once a channel exists, so the channel comes first
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#128C5E',
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    await sendToken(token);
    return token;
}

// firebase replaces a token now and then; the new one goes to the server at once. returns the unsubscribe
export function watchPushToken() {
    if (!supported()) return () => {};
    const subscription = Notifications.addPushTokenListener(({ data }) => { sendToken(data).catch(() => {}); });
    return () => subscription.remove();
}

// a tapped notification opens its chat. openChat(conversationId, title) navigates. covers both a tap
// while the app runs in the background (the listener) and a tap that started the app from closed (the
// tap expo kept for us, read once and cleared so it does not open again). returns the unsubscribe
export function openChatsFromNotifications(openChat) {
    if (!supported()) return () => {};
    const open = (response) => {
        const { conversation_id: conversationId, type } = response?.notification?.request?.content?.data || {};
        // a "new version" tap is the update dialog's (UpdateGate), which also works signed out
        if (type !== 'update' && conversationId) openChat(Number(conversationId), response.notification.request.content.title);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    const launchedBy = Notifications.getLastNotificationResponse();
    if (launchedBy) { Notifications.clearLastNotificationResponse(); open(launchedBy); }
    return () => subscription.remove();
}

// sign-out: this phone stops receiving the user's notifications. must run while still signed in
export async function unregisterPush() {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try { await post('devices/unregister', { push_token: token }); }
    catch (_) { /* the server drops tokens Firebase reports dead; nothing more to do here */ }
    await AsyncStorage.removeItem(TOKEN_KEY);
}
