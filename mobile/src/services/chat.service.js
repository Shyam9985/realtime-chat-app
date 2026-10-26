import { get, post, remove } from "../store/api.service";

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
export const sendMessage = (conversationId, content, clientMessageId) =>
    data(post("messages", { conversation_id: conversationId, content, client_message_id: clientMessageId }));
export const deleteMessage = (messageId) => data(remove(`messages/${messageId}`));
