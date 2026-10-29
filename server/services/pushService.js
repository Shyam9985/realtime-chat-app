const devicesMdl = require('../models/devicesMdl');
const conversationsMdl = require('../models/conversationsMdl');
const appEvents = require('../utils/events.utils');
const { getFirebaseMessaging } = require('../utils/firebase.utils');
const { log } = require('../utils/log.utils');

/*
 * Push notifications. Every new message is announced on the app event bus (the same announcement the
 * socket relay turns into message:new); this turns it into a Firebase push to each recipient's phones.
 * It runs after the message is saved and never blocks or fails a send: a slow or broken Firebase only
 * means no notification. The push is a data message in the layout expo-notifications understands on
 * android: it shows `title` / `message` itself on the `channelId` channel (no app code needed, so it
 * works however the phone is asleep), and `body` (a JSON string) becomes the notification's data, which
 * a tap reads to open the chat. The phone's background task, which also receives it, only marks the
 * message delivered.
 */
const CHANNEL_ID = 'messages';           // created by the app (push.service.js) before it registers

// the fields expo-notifications reads to present a data push, plus our own for the background task
const notificationFields = ({ title, text, data }) => ({
    title, message: text, channelId: CHANNEL_ID, body: JSON.stringify(data),
});
const BODY_MAX = 240;            // the notification shows a preview, not the whole message
const BATCH = 500;               // firebase's limit per multicast call

// firebase's answers for a token that no longer reaches a phone (uninstalled, data cleared, malformed)
const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

const preview = (text) => (text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text);

// what the notification says: one-to-one "Noah" / "hi"; group "Goa Trip" / "Noah: hi"
const contentOf = async (message) => {
    const [conversation] = await conversationsMdl.getTypeAndTitle(message.conversation_id);
    const sender = message.sender_name || 'Someone';
    const group = conversation?.type_code === 'GROUP';
    return {
        title: group ? conversation.title : sender,
        text: preview(group ? `${sender.split(' ')[0]}: ${message.content}` : message.content),
    };
};

// sends one data message to these phones; switches off tokens firebase rejects
const sendToTokens = async (messaging, tokens, data) => {
    let sent = 0;
    const dead = [];
    for (let i = 0; i < tokens.length; i += BATCH) {
        const batch = tokens.slice(i, i + BATCH);
        // high priority wakes the phone at once, so the message can be marked delivered without delay
        const result = await messaging.sendEachForMulticast({ tokens: batch, data, android: { priority: 'high' } });
        sent += result.successCount;
        result.responses.forEach((r, j) => { if (!r.success && DEAD_TOKEN.has(r.error?.code)) dead.push(batch[j]); });
    }
    if (dead.length) await devicesMdl.deactivateTokens(dead);
    log(`[push] ${sent} sent, ${tokens.length - sent} failed, ${dead.length} dead tokens switched off`);
    return { sent, failed: tokens.length - sent };
};

// every active phone of these users
const sendToUsers = async (userIds, data) => {
    const messaging = getFirebaseMessaging();
    if (!messaging || !userIds.length) return { sent: 0, failed: 0 };
    return sendToTokens(messaging, (await devicesMdl.listActiveTokens(userIds)).map((r) => r.push_token), data);
};

// every active phone there is (a new app version)
const sendToAllDevices = async (data) => {
    const messaging = getFirebaseMessaging();
    if (!messaging) return { sent: 0, failed: 0 };
    return sendToTokens(messaging, (await devicesMdl.listAllActiveTokens()).map((r) => r.push_token), data);
};

// a new message (sends, forwards, scheduled sends): every recipient's phones hear about it.
// group notices ("Maya added Noah") are not pushed
const onMessageCreated = async ({ message, recipientIds }) => {
    if (message.message_type === 'SYSTEM' || !recipientIds.length) return;
    const { title, text } = await contentOf(message);
    // firebase data values must be strings. type / message_id are read by the background task (delivered)
    await sendToUsers(recipientIds, {
        type: 'message',
        message_id: String(message.message_id),
        conversation_id: String(message.conversation_id),
        ...notificationFields({ title, text, data: { type: 'message', conversation_id: message.conversation_id, message_id: message.message_id } }),
    });
};

// "YaapZone x.y.z is available" to every registered phone; a tap opens the update dialog
const announceRelease = (release) => sendToAllDevices({
    type: 'update',
    version: release.version,
    ...notificationFields({
        title: `YaapZone ${release.version} is available`,
        text: release.is_mandatory ? 'This update is required. Tap to install it.' : 'Tap to see what’s new and update.',
        data: { type: 'update', version: release.version },
    }),
});

let registered = false;
const registerPushRelay = () => {
    if (registered) return;
    registered = true;
    appEvents.on('message.created', (event) => {
        onMessageCreated(event).catch((error) => console.error('[push] could not send a notification:', error.message));
    });
};

module.exports = { registerPushRelay, sendToUsers, sendToAllDevices, announceRelease };
