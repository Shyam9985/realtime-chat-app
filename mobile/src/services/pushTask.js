import { AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import { post } from '../store/api.service';
import * as tokenStore from '../store/tokenStore';
import * as keyStore from '../crypto/keyStore';
import { CHANNEL_ID, Notifications, pushSupported } from './push.service';
import { requestUpdateCheck } from './update.service';

/*
 * Runs for every push, also while YaapZone is in the background or closed (android then starts the
 * app's JavaScript without any screen). It does what only the app can do:
 *   - a message: messages are end-to-end encrypted, so the push carries the encrypted text and the
 *     server cannot write the notification. This task decrypts it with the keys on this phone and shows
 *     the notification, then tells the server it reached this phone (the sender sees two grey ticks)
 *   - a new app version while the app is open: show the update dialog right away (other version pushes
 *     are shown natively from their title / message fields)
 * It must be defined when the code first loads (index.js imports it before anything else).
 */
export const PUSH_TASK = 'yaapzone-push';
const PREVIEW_MAX = 240;           // the notification shows a preview, not the whole message

// expo hands the push's data map over as a JSON string (dataString)
const readPush = (payload) => {
    const data = payload?.data;
    if (typeof data?.dataString === 'string') {
        try { return JSON.parse(data.dataString); } catch (_) { return null; }
    }
    return data && typeof data === 'object' ? data : null;
};

// the message text, decrypted here; "New message" when this phone cannot (no key yet, or too long for a push)
async function textOf(push) {
    const user = await tokenStore.getUser();
    if (!user || !push.content || push.enc_format !== '1') return 'New message';
    if (!(await keyStore.loadIdentity(user.user_id))) return 'New message';
    const text = await keyStore.decryptText(push.content, {
        conversationId: Number(push.conversation_id), keyVersion: Number(push.key_version), senderId: Number(push.sender_id),
    }).catch(() => null);
    if (!text) return 'New message';
    return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

// one-to-one "Noah" / "hi"; group "Goa Trip" / "Noah: hi". a tap opens the chat (push.service reads the data)
async function showMessage(push) {
    const text = await textOf(push);
    const group = push.is_group === '1';
    await Notifications.scheduleNotificationAsync({
        content: {
            title: push.chat_title || push.sender_name || 'YaapZone',
            body: group ? `${(push.sender_name || 'Someone').split(' ')[0]}: ${text}` : text,
            data: { type: 'message', conversation_id: Number(push.conversation_id), message_id: Number(push.message_id) },
        },
        trigger: { channelId: CHANNEL_ID },
    });
}

TaskManager.defineTask(PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    const push = readPush(data);
    if (push?.type === 'update') {
        if (AppState.currentState === 'active') requestUpdateCheck();
        return;
    }
    if (push?.type !== 'message' || !push.message_id) return;
    // the open app shows new messages itself; otherwise the notification is ours to show
    if (AppState.currentState !== 'active') {
        try { await showMessage(push); } catch (_) { /* no notification, the message is still in the chat */ }
    }
    // no other conditions: if the app is open it was already delivered (the server just says so again),
    // and if nobody is signed in the server refuses it. a failure is caught up at the next app start
    try { await post(`messages/${push.message_id}/delivered`, {}); } catch (_) { /* see above */ }
});

// only the installed android app receives pushes (not expo go)
if (pushSupported()) Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});
