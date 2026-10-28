const devicesMdl = require('../models/devicesMdl');
const conversationsMdl = require('../models/conversationsMdl');
const appEvents = require('../utils/events.utils');
const { getFirebaseMessaging } = require('../utils/firebase.utils');
const { log } = require('../utils/log.utils');

/*
 * Push notifications. Every new message is announced on the app event bus (the same announcement the
 * socket relay turns into message:new); this turns it into a Firebase push to each recipient's phones.
 * It runs after the message is saved and never blocks or fails a send: a slow or broken Firebase only
 * means no notification. The push is DATA-only (no "notification" part): the phone's background task
 * decides what to show, and marks the message delivered even while the app is closed.
 */
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
        body: preview(group ? `${sender.split(' ')[0]}: ${message.content}` : message.content),
        is_group: group ? '1' : '0',
    };
};

// sends one data message to every active phone of these users; switches off tokens firebase rejects
const sendToUsers = async (userIds, data) => {
    const messaging = getFirebaseMessaging();
    if (!messaging || !userIds.length) return { sent: 0, failed: 0 };
    const rows = await devicesMdl.listActiveTokens(userIds);
    const tokens = rows.map((r) => r.push_token);
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

// a new message (sends, forwards, scheduled sends): every recipient's phones hear about it.
// group notices ("Maya added Noah") are not pushed
const onMessageCreated = async ({ message, recipientIds }) => {
    if (message.message_type === 'SYSTEM' || !recipientIds.length) return;
    const content = await contentOf(message);
    // firebase data values must be strings
    await sendToUsers(recipientIds, {
        type: 'message',
        message_id: String(message.message_id),
        conversation_id: String(message.conversation_id),
        sender_id: String(message.sender_id),
        ...content,
    });
};

let registered = false;
const registerPushRelay = () => {
    if (registered) return;
    registered = true;
    appEvents.on('message.created', (event) => {
        onMessageCreated(event).catch((error) => console.error('[push] could not send a notification:', error.message));
    });
};

module.exports = { registerPushRelay, sendToUsers };
