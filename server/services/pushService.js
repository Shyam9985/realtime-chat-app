const devicesMdl = require('../models/devicesMdl');
const conversationsMdl = require('../models/conversationsMdl');
const appEvents = require('../utils/events.utils');
const { getFirebaseMessaging } = require('../utils/firebase.utils');
const { log } = require('../utils/log.utils');

/*
 * Push notifications. Every new message is announced on the app event bus (the same announcement the
 * socket relay turns into message:new); this turns it into a Firebase push to each recipient's phones.
 * It runs after the message is saved and never blocks or fails a send: a slow or broken Firebase only
 * means no notification.
 * Messages are end-to-end encrypted, so the server cannot write the notification text. A message push
 * is a silent data message carrying the encrypted text: the phone's background task decrypts it with
 * the keys only the phone has, shows the notification itself and marks the message delivered.
 * Other pushes (a new app version) are in the layout expo-notifications presents by itself on android:
 * `title` / `message` on the `channelId` channel, and `body` (a JSON string) as the data a tap reads.
 */
const CHANNEL_ID = 'messages';           // created by the app (push.service.js) before it registers

// the fields expo-notifications reads to present a data push, plus our own for the background task
const notificationFields = ({ title, text, data }) => ({
    title, message: text, channelId: CHANNEL_ID, body: JSON.stringify(data),
});
const BATCH = 500;               // firebase's limit per multicast call
// firebase allows 4 KB of data per push: a longer encrypted text is left out and the phone shows
// "New message" (the text is in the chat when it is opened)
const PUSH_CONTENT_MAX = 3000;

// firebase's answers for a token that no longer reaches a phone (uninstalled, data cleared, malformed)
const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

// who the notification is from: one-to-one "Noah"; group "Goa Trip" (the phone adds "Noah: " to the text)
const headingOf = async (message) => {
    const [conversation] = await conversationsMdl.getTypeAndTitle(message.conversation_id);
    const sender = message.sender_name || 'Someone';
    const group = conversation?.type_code === 'GROUP';
    return { chatTitle: group ? conversation.title : sender, sender, group };
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
    const { chatTitle, sender, group } = await headingOf(message);
    const content = message.content && message.content.length <= PUSH_CONTENT_MAX ? message.content : '';
    // firebase data values must be strings. no title / message fields: the phone decrypts the text and
    // shows the notification itself (see the comment at the top)
    await sendToUsers(recipientIds, {
        type: 'message',
        message_id: String(message.message_id),
        conversation_id: String(message.conversation_id),
        sender_id: String(message.sender_id),
        sender_name: sender,
        chat_title: chatTitle || sender,
        is_group: group ? '1' : '0',
        content,
        key_version: String(message.key_version ?? ''),
        enc_format: String(message.enc_format ?? 1),
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
