import { get, post, patch, remove } from "../store/api.service";
import * as keyStore from "../crypto/keyStore";

// Ported from the web client's services/chat.service.js unchanged. Unlike the auth helpers these
// THROW the server's error object ({ statusKey, message, error }) so the chat state can react to
// BLOCKED, NOT_A_MEMBER, ...
// Messages are end-to-end encrypted: text is encrypted here on its way out (keyStore.sendEncrypted) and
// every answer that carries text is decrypted here (keyStore.openTree), so the screens only see plain text.
const data = (promise) => promise.then((r) => r.data);

export const searchUsers = (query, limit = 20) => data(get("users", { query, limit })).then((d) => d.users);
export const listBlocked = () => data(get("users/blocked")).then((d) => d.users);
export const getUserProfile = (userId) => data(get(`users/${userId}`)).then((d) => d.user);
export const blockUser = (userId) => data(post(`users/${userId}/block`, {}));
export const unblockUser = (userId) => data(remove(`users/${userId}/block`));

// the whole list at once: every locked chat key of this user is fetched first, so each preview opens without a request of its own
export const listConversations = async () => {
    const [d] = await Promise.all([data(get("conversations")), keyStore.fetchChatKeys().catch(() => {})]);
    return keyStore.openConversations(d.conversations);
};
export const getOrCreateConversation = (userId) => data(post("conversations", { user_id: userId }))
    .then(async (d) => ({ ...d, conversation: (await keyStore.openConversations([d.conversation]))[0] }));
// days: the opening page holds everything from the last N days (a quiet chat: its newest messages);
// older pages come with the cursor, `limit` at a time
export const getHistory = (conversationId, cursor = null, limit = 30, days = null) =>
    data(get(`conversations/${conversationId}/messages`, cursor ? { cursor, limit } : days ? { days } : { limit })).then((page) => keyStore.openTree(page));
export const markSeen = (conversationId) => data(post(`conversations/${conversationId}/seen`, {}));
export const markDelivered = (messageId) => data(post(`messages/${messageId}/delivered`, {}));
// encrypted: { content, key_version } from keyStore.sendEncrypted
export const sendMessage = (conversationId, encrypted, clientMessageId, replyToMessageId = null) =>
    data(post("messages", { conversation_id: conversationId, ...encrypted, client_message_id: clientMessageId, ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}) }))
        .then((d) => keyStore.openTree(d));
export const deleteMessage = (messageId) => data(remove(`messages/${messageId}`)).then((d) => keyStore.openTree(d));

// release 2: personal chat settings, read all, edit, forward, scheduled messages (search runs on the phone)
export const updateConversationSettings = (conversationId, settings) =>
    data(patch(`conversations/${conversationId}/settings`, settings)).then(async (d) => (await keyStore.openConversations([d.conversation]))[0]);
export const readAll = () => data(post("conversations/read-all", {}));
export const editMessage = (message, text) => keyStore.sendEncrypted(message.conversation_id, text,
    (encrypted) => data(patch(`messages/${message.message_id}`, encrypted))).then((d) => keyStore.openTree(d));
// every version of own message: each decrypted with the key it was written with
export const getEditHistory = (message) => data(get(`messages/${message.message_id}/edits`))
    .then((d) => keyStore.openTree(d.versions, { conversationId: message.conversation_id, senderId: message.sender_id }));
// the text is encrypted once per target chat (each has its own key)
export async function forwardMessage(message, conversationIds) {
    const targets = [];
    for (const conversationId of conversationIds) {
        targets.push({ conversation_id: conversationId, ...(await keyStore.encryptText(conversationId, message.content)) });
    }
    return data(post(`messages/${message.message_id}/forward`, { targets })).then((d) => keyStore.openTree(d));
}
export const listScheduled = (conversationId, myId) => data(get(`conversations/${conversationId}/scheduled`))
    .then((d) => keyStore.openTree(d.scheduled, { conversationId, senderId: myId }));
export const scheduleMessage = (conversationId, content, sendAt, replyToMessageId = null, myId = null) => keyStore.sendEncrypted(conversationId, content,
    (encrypted) => data(post(`conversations/${conversationId}/scheduled`, { ...encrypted, send_at: sendAt, ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}) })))
    .then((d) => keyStore.openTree(d.scheduled, { conversationId, senderId: myId }));
// changes.content (plain text) is encrypted for the scheduled message's chat
export async function updateScheduled(scheduled, changes, myId = null) {
    const { content, ...rest } = changes;
    const send = (encrypted) => data(patch(`scheduled/${scheduled.scheduled_message_id}`, { ...rest, ...(encrypted || {}) }));
    const d = content !== undefined ? await keyStore.sendEncrypted(scheduled.conversation_id, content, send) : await send(null);
    return keyStore.openTree(d.scheduled, { conversationId: scheduled.conversation_id, senderId: myId });
}
export const cancelScheduled = (scheduledId) => data(remove(`scheduled/${scheduledId}`));

// groups: one chat summary, create, details and members, admin actions, exit, delete after exiting
export const getConversation = (conversationId) => data(get(`conversations/${conversationId}`)).then(async (d) => (await keyStore.openConversations([d.conversation]))[0]);
export const createGroup = (title, description, memberIds) =>
    data(post("conversations/groups", { title, member_ids: memberIds, ...(description ? { description } : {}) }))
        .then(async (d) => ({ ...d, conversation: d.conversation ? (await keyStore.openConversations([d.conversation]))[0] : d.conversation }));
export const getGroup = (conversationId) => data(get(`conversations/${conversationId}/group`)).then((d) => d.group);
export const updateGroup = (conversationId, changes) => data(patch(`conversations/${conversationId}/group`, changes));
export const addGroupMembers = (conversationId, userIds) => data(post(`conversations/${conversationId}/members`, { user_ids: userIds }));
export const removeGroupMember = (conversationId, userId) => data(remove(`conversations/${conversationId}/members/${userId}`));
export const setGroupMemberRole = (conversationId, userId, role) => data(patch(`conversations/${conversationId}/members/${userId}`, { role }));
export const leaveGroup = (conversationId) => data(post(`conversations/${conversationId}/leave`, {}))
    .then(async (d) => ({ ...d, conversation: d.conversation ? (await keyStore.openConversations([d.conversation]))[0] : d.conversation }));
export const deleteGroup = (conversationId) => data(remove(`conversations/${conversationId}`));
export const getMessageReceipts = (messageId) => data(get(`messages/${messageId}/receipts`)).then((d) => d.receipts);
