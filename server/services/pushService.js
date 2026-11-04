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

// firebase's answers for a token that no longer reaches a phone (uninstalled, data cleared, malformed).
// invalid-argument counts only when firebase says it is about the token: the same code also means
// "I refuse this payload" (every token at once, nothing wrong with the phones), and treating that as
// dead switched every phone off in 1.5.0
const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
const isDeadToken = (error) => DEAD_TOKEN.has(error?.code)
    || (error?.code === 'messaging/invalid-argument' && /registration token/i.test(error.message || ''));
// data keys firebase reserves; a push carrying one is refused with "Invalid data payload key"
const RESERVED_KEY = /^(from|notification|message_type|gcm|google)/;

// who the notification is from: one-to-one "Noah"; group "Goa Trip" (the phone adds "Noah: " to the text)
const headingOf = async (message) => {
    const [conversation] = await conversationsMdl.getTypeAndTitle(message.conversation_id);
    const sender = message.sender_name || 'Someone';
    const group = conversation?.type_code === 'GROUP';
    return { chatTitle: group ? conversation.title : sender, sender, group };
};

// sends one data message to these phones; switches off tokens firebase says are dead. answers how it
// went, with every refusal's code (a payload refused by firebase shows here, not as "dead phones")
const sendToTokens = async (messaging, tokens, data) => {
    const reserved = Object.keys(data).filter((k) => RESERVED_KEY.test(k));
    if (reserved.length) throw new Error(`push data uses a key firebase reserves: ${reserved.join(', ')}`);
    let sent = 0;
    const dead = [];
    const errors = [];
    for (let i = 0; i < tokens.length; i += BATCH) {
        const batch = tokens.slice(i, i + BATCH);
        // high priority wakes the phone at once, so the message can be marked delivered without delay
        const result = await messaging.sendEachForMulticast({ tokens: batch, data, android: { priority: 'high' } });
        sent += result.successCount;
        result.responses.forEach((r, j) => {
            if (r.success) return;
            errors.push(r.error?.code || 'unknown');
            if (isDeadToken(r.error)) dead.push(batch[j]);
        });
    }
    if (dead.length) await devicesMdl.deactivateTokens(dead);
    if (errors.length) console.error(`[push] firebase refused ${errors.length} of ${tokens.length}: ${[...new Set(errors)].join(', ')}`);
    log(`[push] ${sent} sent, ${tokens.length - sent} failed, ${dead.length} dead tokens switched off`);
    return { sent, failed: tokens.length - sent, dead: dead.length, errors };
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

// the data a message push carries. firebase data values must be strings and keys must not be ones it
// reserves ("message_type" is: hence msg_type). no title / message fields: the phone decrypts the text
// and shows the notification itself (see the comment at the top). a sticker's content (its id) is left
// out: the phone says "Sticker" from msg_type, and an app that does not know msg_type says "New message"
const messageDataOf = (message, { chatTitle, sender, group }) => {
    const kind = String(message.message_type || 'TEXT');
    const content = kind !== 'STICKER' && message.content && message.content.length <= PUSH_CONTENT_MAX ? message.content : '';
    return {
        type: 'message',
        message_id: String(message.message_id),
        conversation_id: String(message.conversation_id),
        sender_id: String(message.sender_id),
        msg_type: kind,
        sender_name: sender,
        chat_title: chatTitle || sender,
        is_group: group ? '1' : '0',
        content,
        key_version: String(message.key_version ?? ''),
        enc_format: String(message.enc_format ?? 1),
    };
};

// a new message (sends, forwards, scheduled sends): every recipient's phones hear about it.
// group notices ("Maya added Noah") are not pushed
const onMessageCreated = async ({ message, recipientIds }) => {
    if (message.message_type === 'SYSTEM' || !recipientIds.length) return { sent: 0, failed: 0 };
    return sendToUsers(recipientIds, messageDataOf(message, await headingOf(message)));
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

module.exports = { registerPushRelay, sendToUsers, sendToAllDevices, announceRelease, messageDataOf, onMessageCreated, RESERVED_KEY };
