import { AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { post } from '../store/api.service';
import * as tokenStore from '../store/tokenStore';
import { CHANNEL_ID, pushSupported } from './push.service';
import { requestUpdateCheck } from './update.service';

/*
 * What happens when a push arrives while YaapZone is in the background or closed. Android starts the
 * app's JavaScript without any screen (a "headless" start) and runs this task:
 *   1. tell the server the message reached this phone  -> the sender sees two grey ticks
 *   2. show the notification ("Noah" / "hi")
 * It must be defined when the code first loads (index.js imports this before anything else), because a
 * headless start never renders the app. While the app is open the live connection already does both
 * jobs, so the task then does nothing.
 */
export const PUSH_TASK = 'yaapzone-push';

// our server sends a data-only push; expo hands its data map over as a JSON string
const readPush = (payload) => {
    const data = payload?.data;
    if (typeof data?.dataString === 'string') {
        try { return JSON.parse(data.dataString); } catch (_) { return null; }
    }
    return data && typeof data === 'object' ? data : null;
};

TaskManager.defineTask(PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    const push = readPush(data);

    // a new app version (to everyone, signed in or not): open app -> the update dialog at once;
    // otherwise a notification that opens it
    if (push?.type === 'update') {
        if (AppState.currentState === 'active') { requestUpdateCheck(); return; }
        await Notifications.scheduleNotificationAsync({ content: { title: push.title, body: push.body, data: { type: 'update' } }, trigger: { channelId: CHANNEL_ID } });
        return;
    }

    if (push?.type !== 'message' || AppState.currentState === 'active') return;
    // signed out on this phone: nothing to acknowledge and nothing to show
    if (!(await tokenStore.getToken())) return;

    // 1. delivered. a failure (no signal, expired sign-in) is fine: the app marks it on the next start
    try { await post(`messages/${push.message_id}/delivered`, {}); } catch (_) { /* see above */ }

    // 2. the notification, on the "Messages" channel. the chat id comes along for opening it (step 7)
    await Notifications.scheduleNotificationAsync({
        content: { title: push.title, body: push.body, data: { conversation_id: Number(push.conversation_id), message_id: Number(push.message_id) } },
        trigger: { channelId: CHANNEL_ID },
    });
});

// only the installed android app receives pushes (not expo go)
if (pushSupported()) Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});
