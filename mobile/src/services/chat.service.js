import { get, post, patch, remove } from "../store/api.service";

// Ported from the web client's services/chat.service.js unchanged. Unlike the auth helpers these
// THROW the server's error object ({ statusKey, message, error }) so the chat state can react to
// BLOCKED, NOT_A_MEMBER, ...
const data = (promise) => promise.then((r) => r.data);

export const searchUsers = (query, limit = 20) => data(get("users", { query, limit })).then((d) => d.users);
export const listBlocked = () => data(get("users/blocked")).then((d) => d.users);
export const getUserProfile = (userId) => data(get(`users/${userId}`)).then((d) => d.user);
export const blockUser = (userId) => data(post(`users/${userId}/block`, {}));
export const unblockUser = (userId) => data(remove(`users/${userId}/block`));

export const listConversations = () => data(get("conversations")).then((d) => d.conversations);
export const getOrCreateConversation = (userId) => data(post("conversations", { user_id: userId }));
export const getHistory = (conversationId, cursor = null, limit = 30) =>
    data(get(`conversations/${conversationId}/messages`, cursor ? { cursor, limit } : { limit }));
export const markSeen = (conversationId) => data(post(`conversations/${conversationId}/seen`, {}));
export const markDelivered = (messageId) => data(post(`messages/${messageId}/delivered`, {}));
export const sendMessage = (conversationId, content, clientMessageId, replyToMessageId = null) =>
    data(post("messages", { conversation_id: conversationId, content, client_message_id: clientMessageId, ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}) }));
export const deleteMessage = (messageId) => data(remove(`messages/${messageId}`));

// release 2: personal chat settings, read all, search, edit, forward, scheduled messages
export const updateConversationSettings = (conversationId, settings) =>
    data(patch(`conversations/${conversationId}/settings`, settings)).then((d) => d.conversation);
export const readAll = () => data(post("conversations/read-all", {}));
export const searchMessages = (conversationId, q, limit = 50) =>
    data(get(`conversations/${conversationId}/messages/search`, { q, limit })).then((d) => d.messages);
export const editMessage = (messageId, content) => data(patch(`messages/${messageId}`, { content }));
export const getEditHistory = (messageId) => data(get(`messages/${messageId}/edits`)).then((d) => d.versions);
export const forwardMessage = (messageId, conversationIds) =>
    data(post(`messages/${messageId}/forward`, { conversation_ids: conversationIds }));
export const listScheduled = (conversationId) => data(get(`conversations/${conversationId}/scheduled`)).then((d) => d.scheduled);
export const scheduleMessage = (conversationId, content, sendAt, replyToMessageId = null) =>
    data(post(`conversations/${conversationId}/scheduled`, { content, send_at: sendAt, ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}) }))
        .then((d) => d.scheduled);
export const updateScheduled = (scheduledId, changes) => data(patch(`scheduled/${scheduledId}`, changes)).then((d) => d.scheduled);
export const cancelScheduled = (scheduledId) => data(remove(`scheduled/${scheduledId}`));
