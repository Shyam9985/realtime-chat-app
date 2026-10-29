import { AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { post } from '../store/api.service';
import { pushSupported } from './push.service';
import { requestUpdateCheck } from './update.service';

/*
 * Runs for every push, also while YaapZone is in the background or closed (android then starts the
 * app's JavaScript without any screen). Showing the notification is NOT done here: expo-notifications
 * shows it natively from the push's title / message fields, which works however deeply the phone is
 * asleep. This task does what only the app can do:
 *   - a message: tell the server it reached this phone  -> the sender sees two grey ticks
 *   - a new app version while the app is open: show the update dialog right away
 * It must be defined when the code first loads (index.js imports it before anything else).
 */
export const PUSH_TASK = 'yaapzone-push';

// expo hands the push's data map over as a JSON string (dataString)
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
    if (push?.type === 'update') {
        if (AppState.currentState === 'active') requestUpdateCheck();
        return;
    }
    if (push?.type !== 'message' || !push.message_id) return;
    // no other conditions: if the app is open it was already delivered (the server just says so again),
    // and if nobody is signed in the server refuses it. a failure is caught up at the next app start
    try { await post(`messages/${push.message_id}/delivered`, {}); } catch (_) { /* see above */ }
});

// only the installed android app receives pushes (not expo go)
if (pushSupported()) Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});
