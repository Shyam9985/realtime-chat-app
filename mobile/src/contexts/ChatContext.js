import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import * as chatApi from "../services/chat.service";
import * as socket from "../services/socket.service";
import * as keyStore from "../crypto/keyStore";
import { registerForPush, watchPushToken } from "../services/push.service";
import { useAuth } from "./AuthContext";

/*
 * Ported from the web client's contexts/ChatContext.jsx: the same reducer, actions and socket wiring.
 *  conversations : list screen, newest activity first
 *  threads       : per conversation { messages (newest first), nextCursor, hasMore, status, error }
 *  socketStatus  : 'connected' | 'connecting' | 'disconnected' | 'unauthorized'
 * Two adaptations: the signed-in user comes from AuthContext (the web read localStorage 'user-data'),
 * and because this provider wraps the whole app it connects when the user signs in and resets when
 * they sign out, where the web connected on mount and disconnected on unmount of the signed-in layout.
 */
const ChatContext = createContext(null);

// scheduledVersion: per conversation, bumped when the sender's scheduled messages change (screens refetch)
// groupVersion: per group, bumped when its members, roles, name or description change (screens refetch)
// presence: per user { online, last_seen_at } for the "Online" / "last active ..." line
const initialState = { conversations: [], conversationsStatus: "idle", conversationsError: null, threads: {}, socketStatus: "disconnected", scheduledVersion: {}, groupVersion: {}, presence: {} };
const OPENING_DAYS = 7;     // a chat opens with its last week of messages
const emptyThread = () => ({ messages: [], nextCursor: null, hasMore: true, status: "idle", error: null });

const ts = (v) => (v ? new Date(v).getTime() : 0);
// pinned chats first (most recently pinned on top), then everything by latest activity: the same order the server uses
const sortConversations = (list) => [...list].sort((a, b) => ((b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)) || (ts(b.pinned_at) - ts(a.pinned_at))
    || (ts(b.last_message_at || b.created_at) - ts(a.last_message_at || a.created_at)) || (b.conversation_id - a.conversation_id));
const sameMessage = (a, b) => (a.message_id && a.message_id === b.message_id) || (a.client_message_id && a.client_message_id === b.client_message_id);

// ticks only move forward: sending -> sent -> delivered -> seen. socket events and api answers can
// arrive in any order (a delivered event can beat the send acknowledgement), so a later, older
// state never overwrites a newer one
const STATUS_RANK = { FAILED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, SEEN: 4 };
const rank = (status) => STATUS_RANK[status] ?? 0;

const mergeMessage = (messages, incoming) => {
    const index = messages.findIndex((m) => sameMessage(m, incoming));
    if (index >= 0) {
        const prev = messages[index];
        const merged = { ...prev, ...incoming, local: undefined };
        if (rank(prev.status) > rank(merged.status)) {
            merged.status = prev.status;
            merged.delivered_at = prev.delivered_at ?? merged.delivered_at;
            merged.seen_at = prev.seen_at ?? merged.seen_at;
        }
        const next = [...messages];
        next[index] = merged;
        return next;
    }
    return [incoming, ...messages].sort((a, b) => (ts(b.created_at) - ts(a.created_at)) || ((b.message_id || 0) - (a.message_id || 0)));
};

// fields may be a function of the message, for updates that depend on what it already holds
const patch = (messages, predicate, fields) => messages.map((m) => (predicate(m) ? { ...m, ...(typeof fields === "function" ? fields(m) : fields) } : m));

function reducer(state, action) {
    switch (action.type) {
        case "SOCKET_STATUS": return { ...state, socketStatus: action.status };
        case "CONVERSATIONS_LOADING": return { ...state, conversationsStatus: state.conversations.length ? state.conversationsStatus : "loading", conversationsError: null };
        case "CONVERSATIONS_LOADED": return { ...state, conversations: sortConversations(action.conversations), conversationsStatus: "ready", conversationsError: null };
        case "CONVERSATIONS_ERROR": return { ...state, conversationsStatus: state.conversations.length ? "ready" : "error", conversationsError: action.error };
        case "CONVERSATION_UPSERT": return { ...state, conversations: sortConversations([action.conversation, ...state.conversations.filter((c) => c.conversation_id !== action.conversation.conversation_id)]) };
        case "CONVERSATION_PATCH": return { ...state, conversations: sortConversations(state.conversations.map((c) => (c.conversation_id === action.id ? { ...c, ...action.fields } : c))) };
        case "CONVERSATION_PREVIEW": {
            const { message, incrementUnread } = action;
            return {
                ...state,
                conversations: sortConversations(state.conversations.map((c) => c.conversation_id !== message.conversation_id ? c : {
                    ...c,
                    last_message: {
                        message_id: message.message_id, sender_id: message.sender_id, sender_name: message.sender_name, message_type: message.message_type,
                        system_event: message.system_event, system_target_user_id: message.system_target_user_id, system_target_name: message.system_target_name,
                        content: message.content, is_deleted: message.is_deleted, created_at: message.created_at, status: message.status,
                    },
                    last_message_at: message.created_at,
                    unread_count: incrementUnread ? (c.unread_count || 0) + 1 : c.unread_count,
                })),
            };
        }
        // a delivered / seen event for the message the chat list shows as the last one
        case "PREVIEW_STATUS": {
            const ids = new Set(action.messageIds);
            return {
                ...state,
                conversations: state.conversations.map((c) => (c.conversation_id !== action.conversationId || !c.last_message || !ids.has(c.last_message.message_id) || rank(c.last_message.status) >= rank(action.status)
                    ? c : { ...c, last_message: { ...c.last_message, status: action.status } })),
            };
        }
        case "THREAD_LOADING": { const t = state.threads[action.id] || emptyThread(); return { ...state, threads: { ...state.threads, [action.id]: { ...t, status: "loading", error: null } } }; }
        case "THREAD_LOADED": {
            const t = state.threads[action.id] || emptyThread();
            let messages = t.messages;
            for (const m of action.messages) messages = mergeMessage(messages, m);
            const keep = action.refresh && t.nextCursor !== undefined && t.messages.length > action.messages.length;
            return { ...state, threads: { ...state.threads, [action.id]: { ...t, messages, nextCursor: keep ? t.nextCursor : action.nextCursor, hasMore: keep ? t.hasMore : action.hasMore, status: "ready", error: null } } };
        }
        case "THREAD_ERROR": { const t = state.threads[action.id] || emptyThread(); return { ...state, threads: { ...state.threads, [action.id]: { ...t, status: t.messages.length ? "ready" : "error", error: action.error } } }; }
        case "MESSAGE_MERGE": { const id = action.message.conversation_id; const t = state.threads[id] || emptyThread(); return { ...state, threads: { ...state.threads, [id]: { ...t, messages: mergeMessage(t.messages, action.message) } } }; }
        case "MESSAGE_UPDATE": { const id = action.message.conversation_id; const t = state.threads[id]; if (!t) return state; return { ...state, threads: { ...state.threads, [id]: { ...t, messages: mergeMessage(t.messages, action.message) } } }; }
        // an edited message that the chat list shows as the last one
        case "PREVIEW_CONTENT": return { ...state, conversations: state.conversations.map((c) => (c.conversation_id === action.message.conversation_id && c.last_message?.message_id === action.message.message_id ? { ...c, last_message: { ...c.last_message, content: action.message.content } } : c)) };
        case "UNREAD_CLEARED": return { ...state, conversations: state.conversations.map((c) => (c.unread_count ? { ...c, unread_count: 0 } : c)) };
        case "SCHEDULED_CHANGED": return { ...state, scheduledVersion: { ...state.scheduledVersion, [action.id]: (state.scheduledVersion[action.id] || 0) + 1 } };
        case "PRESENCE": return { ...state, presence: { ...state.presence, [action.userId]: { online: action.online, last_seen_at: action.lastSeenAt } } };
        case "GROUP_CHANGED": return { ...state, groupVersion: { ...state.groupVersion, [action.id]: (state.groupVersion[action.id] || 0) + 1 } };
        // a group deleted from the list after exiting it: the chat and its messages leave this phone's state
        case "CONVERSATION_REMOVE": {
            const { [action.id]: _gone, ...threads } = state.threads;
            return { ...state, conversations: state.conversations.filter((c) => c.conversation_id !== action.id), threads };
        }
        case "MESSAGE_PATCH": { const t = state.threads[action.conversationId]; if (!t) return state; return { ...state, threads: { ...state.threads, [action.conversationId]: { ...t, messages: patch(t.messages, action.predicate, action.fields) } } }; }
        case "MESSAGE_REMOVE": { const t = state.threads[action.conversationId]; if (!t) return state; return { ...state, threads: { ...state.threads, [action.conversationId]: { ...t, messages: t.messages.filter((m) => !action.predicate(m)) } } }; }
        case "RESET": return initialState;
        default: return state;
    }
}

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16); }));

export function ChatProvider({ children }) {
    const { status: authStatus, user, handleLogOut } = useAuth();
    const [state, dispatch] = useReducer(reducer, initialState);
    const active = useRef(null);
    const myId = user?.user_id ?? null;

    const refreshConversations = useCallback(async () => {
        dispatch({ type: "CONVERSATIONS_LOADING" });
        try { dispatch({ type: "CONVERSATIONS_LOADED", conversations: await chatApi.listConversations() }); }
        catch (error) { dispatch({ type: "CONVERSATIONS_ERROR", error: error?.error || error?.message || "Could not load chats." }); }
    }, []);

    // refresh: reload the newest page of a thread that is already on screen (merged, pagination kept)
    const loadHistory = useCallback(async (conversationId, cursor = null, refresh = false) => {
        dispatch({ type: "THREAD_LOADING", id: conversationId });
        try {
            // opening (no cursor): the last week at once; scrolling up: older pages
            const page = await chatApi.getHistory(conversationId, cursor, 30, cursor ? null : OPENING_DAYS);
            dispatch({ type: "THREAD_LOADED", id: conversationId, messages: page.messages, nextCursor: page.next_cursor, hasMore: page.has_more, refresh });
        } catch (error) {
            dispatch({ type: "THREAD_ERROR", id: conversationId, error: error?.error || error?.message || "Could not load messages." });
        }
    }, []);

    const loadOlder = useCallback((conversationId) => {
        const t = state.threads[conversationId];
        if (!t || t.status === "loading" || !t.hasMore || !t.nextCursor) return;
        return loadHistory(conversationId, t.nextCursor);
    }, [state.threads, loadHistory]);

    const sendSeen = useCallback(async (conversationId) => {
        dispatch({ type: "CONVERSATION_PATCH", id: conversationId, fields: { unread_count: 0 } });
        try { if (socket.isConnected()) await socket.emitWithAck("message:seen", { conversation_id: conversationId }); else await chatApi.markSeen(conversationId); }
        catch (_) { /* the next open retries */ }
    }, []);

    const sendDelivered = useCallback(async (messageId) => {
        try { if (socket.isConnected()) await socket.emitWithAck("message:delivered", { message_id: messageId }); else await chatApi.markDelivered(messageId); }
        catch (_) { /* the reconnect sweep covers it */ }
    }, []);

    const openConversation = useCallback(async (conversationId) => {
        active.current = conversationId;
        // always fetch the newest page: ticks that changed while this phone's socket was down
        // (app in the background) would otherwise stay stale until the next send
        await loadHistory(conversationId, null, !!state.threads[conversationId]?.messages.length);
        sendSeen(conversationId);
    }, [state.threads, loadHistory, sendSeen]);

    const closeConversation = useCallback((conversationId) => { if (active.current === conversationId) active.current = null; }, []);

    // replyTo: the message being quoted ({ message_id, sender_id, content }), or null
    const sendMessage = useCallback(async (conversationId, text, replyTo = null) => {
        const content = text.trim();
        if (!content) return;
        const clientMessageId = uuid();
        const replyPreview = replyTo ? { message_id: replyTo.message_id, sender_id: replyTo.sender_id, content: replyTo.content, is_deleted: false } : null;
        dispatch({ type: "MESSAGE_MERGE", message: { message_id: null, client_message_id: clientMessageId, conversation_id: conversationId, sender_id: myId, content, is_deleted: false, created_at: new Date().toISOString(), status: "SENDING", local: true, reply_to: replyPreview } });
        try {
            const replyToId = replyTo?.message_id ?? null;
            // encrypted on this phone with the chat's current key; re-encrypted if the key changed meanwhile
            const result = await keyStore.sendEncrypted(conversationId, content, async (encrypted) => (socket.isConnected()
                ? keyStore.openTree(await socket.emitWithAck("message:send", { conversation_id: conversationId, ...encrypted, client_message_id: clientMessageId, ...(replyToId ? { reply_to_message_id: replyToId } : {}) }))
                : chatApi.sendMessage(conversationId, encrypted, clientMessageId, replyToId)));
            dispatch({ type: "MESSAGE_MERGE", message: result.message });
            dispatch({ type: "CONVERSATION_PREVIEW", message: result.message, incrementUnread: false });
            return result.message;
        } catch (error) {
            dispatch({ type: "MESSAGE_PATCH", conversationId, predicate: (m) => m.client_message_id === clientMessageId, fields: { status: "FAILED", error: error?.message || error?.error || "Not sent", errorKey: error?.statusKey } });
            throw error;
        }
    }, [myId]);

    const retryMessage = useCallback(async (message) => {
        dispatch({ type: "MESSAGE_REMOVE", conversationId: message.conversation_id, predicate: (m) => m.client_message_id === message.client_message_id });
        return sendMessage(message.conversation_id, message.content, message.reply_to?.message_id ? message.reply_to : null);
    }, [sendMessage]);

    const discardMessage = useCallback((message) => dispatch({ type: "MESSAGE_REMOVE", conversationId: message.conversation_id, predicate: (m) => m.client_message_id === message.client_message_id }), []);

    const deleteMessage = useCallback(async (message) => {
        const result = await chatApi.deleteMessage(message.message_id);
        dispatch({ type: "MESSAGE_MERGE", message: result.message });
        return result.message;
    }, []);

    // edit own message (within the server's window); the other member's screen updates through message:edited
    const editMessage = useCallback(async (message, text) => {
        const result = await chatApi.editMessage(message, text.trim());
        dispatch({ type: "MESSAGE_UPDATE", message: result.message });
        dispatch({ type: "PREVIEW_CONTENT", message: result.message });
        return result;
    }, []);

    // forward to several chats; the results say which ones were refused (e.g. blocked)
    const forwardMessage = useCallback(async (message, conversationIds) => {
        const result = await chatApi.forwardMessage(message, conversationIds);
        for (const r of result.results) {
            if (!r.ok) continue;
            dispatch({ type: "MESSAGE_UPDATE", message: r.message });
            dispatch({ type: "CONVERSATION_PREVIEW", message: r.message, incrementUnread: false });
        }
        return result;
    }, []);

    // pin / archive / rename: personal to this member
    const updateConversationSettings = useCallback(async (conversationId, settings) => {
        const conversation = await chatApi.updateConversationSettings(conversationId, settings);
        dispatch({ type: "CONVERSATION_UPSERT", conversation });
        return conversation;
    }, []);

    const readAll = useCallback(async () => {
        const result = await chatApi.readAll();
        dispatch({ type: "UNREAD_CLEARED" });
        return result;
    }, []);

    // loads older pages until the message is in the thread (search results, reply quotes). gives up
    // after `maxPages` pages so a missing message never loops forever
    const threadsRef = useRef(state.threads);
    threadsRef.current = state.threads;
    const ensureMessageLoaded = useCallback(async (conversationId, messageId, maxPages = 30) => {
        for (let page = 0; page < maxPages; page += 1) {
            const t = threadsRef.current[conversationId];
            if (t?.messages.some((m) => m.message_id === messageId)) return true;
            if (!t || !t.hasMore || !t.nextCursor) return false;
            await loadHistory(conversationId, t.nextCursor);
            await new Promise((resolve) => setTimeout(resolve, 0));   // let the reducer commit before the next check
        }
        return false;
    }, [loadHistory]);

    const startConversation = useCallback(async (userId) => {
        const { conversation } = await chatApi.getOrCreateConversation(userId);
        dispatch({ type: "CONVERSATION_UPSERT", conversation });
        return conversation;
    }, []);

    // one chat's summary again (a group whose members, roles or name changed); gone when no longer readable
    const refreshConversation = useCallback(async (conversationId) => {
        try { dispatch({ type: "CONVERSATION_UPSERT", conversation: await chatApi.getConversation(conversationId) }); }
        catch (error) { if (error?.statusKey === "NOT_A_MEMBER") dispatch({ type: "CONVERSATION_REMOVE", id: conversationId }); }
    }, []);

    // someone's "Online" / "last active": loaded with their profile, then kept current by presence:update
    const loadPresence = useCallback(async (userId) => {
        try {
            const user = await chatApi.getUserProfile(userId);
            dispatch({ type: "PRESENCE", userId, online: user.online, lastSeenAt: user.last_seen_at });
        } catch (_) { /* no line under the name */ }
    }, []);

    // groups. skipped: the people who could not be added (blocked, or no longer on YaapZone)
    const createGroup = useCallback(async (title, description, memberIds) => {
        const { conversation, skipped_user_ids: skipped } = await chatApi.createGroup(title, description, memberIds);
        dispatch({ type: "CONVERSATION_UPSERT", conversation });
        return { conversation, skipped };
    }, []);

    // any member can exit; the group stays in their list, read-only
    const leaveGroup = useCallback(async (conversationId) => {
        const { conversation } = await chatApi.leaveGroup(conversationId);
        dispatch({ type: "CONVERSATION_UPSERT", conversation });
        dispatch({ type: "GROUP_CHANGED", id: conversationId });
        loadHistory(conversationId, null, true);
        return conversation;
    }, [loadHistory]);

    // only after exiting: the group leaves the list
    const deleteGroup = useCallback(async (conversationId) => {
        await chatApi.deleteGroup(conversationId);
        dispatch({ type: "CONVERSATION_REMOVE", id: conversationId });
    }, []);

    const setBlockedFlag = (userId, blocked) => state.conversations.filter((c) => c.other_user?.user_id === userId).forEach((c) => dispatch({ type: "CONVERSATION_PATCH", id: c.conversation_id, fields: { blocked_by_me: blocked } }));
    const blockUser = useCallback(async (userId) => { await chatApi.blockUser(userId); setBlockedFlag(userId, true); }, [state.conversations]);     // eslint-disable-line react-hooks/exhaustive-deps
    const unblockUser = useCallback(async (userId) => { await chatApi.unblockUser(userId); setBlockedFlag(userId, false); }, [state.conversations]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (authStatus !== "signedIn") { dispatch({ type: "RESET" }); return undefined; }
        socket.connect();
        // events that carry message text are decrypted first, one after another so their order holds
        let chain = Promise.resolve();
        const decrypted = (handler, open = keyStore.openTree) => (payload) => {
            chain = chain.then(async () => handler(await open(payload))).catch(() => {});
        };
        const openSummary = async (c) => (await keyStore.openConversations([c]))[0];
        refreshConversations();
        // push notifications: this phone's token goes to the server (and again whenever firebase renews it)
        registerForPush().catch(() => {});
        const stopWatchingToken = watchPushToken();
        const offs = [
            socket.onStatus((s) => {
                dispatch({ type: "SOCKET_STATUS", status: s });
                if (s === "connected") { refreshConversations(); if (active.current) { loadHistory(active.current, null, true); sendSeen(active.current); } }
            }),
            socket.on("message:new", decrypted((message) => {
                const isOpen = active.current === message.conversation_id;
                // group notices arrive already read: they never count as unread and need no acknowledgement
                const notice = message.message_type === "SYSTEM";
                dispatch({ type: "MESSAGE_MERGE", message });
                if (state.conversations.some((c) => c.conversation_id === message.conversation_id)) dispatch({ type: "CONVERSATION_PREVIEW", message, incrementUnread: !isOpen && !notice });
                else refreshConversations();
                if (notice) return;
                sendDelivered(message.message_id);
                if (isOpen) sendSeen(message.conversation_id);
            })),
            socket.on("message:sent", decrypted((message) => { dispatch({ type: "MESSAGE_MERGE", message }); dispatch({ type: "CONVERSATION_PREVIEW", message, incrementUnread: false }); })),
            socket.on("message:delivered", ({ message_id, conversation_id, delivered_at }) => {
                dispatch({ type: "MESSAGE_PATCH", conversationId: conversation_id, predicate: (m) => m.message_id === message_id && rank(m.status) < rank("DELIVERED"), fields: { delivered_at, status: "DELIVERED" } });
                dispatch({ type: "PREVIEW_STATUS", conversationId: conversation_id, messageIds: [message_id], status: "DELIVERED" });
            }),
            socket.on("message:seen", ({ conversation_id, message_ids, seen_at }) => {
                const ids = new Set(message_ids);
                dispatch({ type: "MESSAGE_PATCH", conversationId: conversation_id, predicate: (m) => ids.has(m.message_id), fields: (m) => ({ seen_at, delivered_at: m.delivered_at || seen_at, status: "SEEN" }) });
                dispatch({ type: "PREVIEW_STATUS", conversationId: conversation_id, messageIds: message_ids, status: "SEEN" });
            }),
            socket.on("message:deleted", ({ message_id, conversation_id, deleted_at }) => { dispatch({ type: "MESSAGE_PATCH", conversationId: conversation_id, predicate: (m) => m.message_id === message_id, fields: { is_deleted: true, content: null, deleted_at } }); refreshConversations(); }),
            socket.on("conversation:new", () => refreshConversations()),
            socket.on("message:edited", decrypted((message) => { dispatch({ type: "MESSAGE_UPDATE", message }); dispatch({ type: "PREVIEW_CONTENT", message }); })),
            socket.on("conversation:updated", decrypted((conversation) => dispatch({ type: "CONVERSATION_UPSERT", conversation }), openSummary)),
            // a new chat key version: the next send uses it (this phone fetches its locked copy when needed)
            socket.on("conversation:key", ({ conversation_id }) => keyStore.forgetSendKey(conversation_id)),
            socket.on("scheduled:changed", ({ conversation_id }) => dispatch({ type: "SCHEDULED_CHANGED", id: conversation_id })),
            // a group changed (members, roles, name): its summary is reloaded, open group screens refetch
            socket.on("group:updated", ({ conversation_id }) => { refreshConversation(conversation_id); dispatch({ type: "GROUP_CHANGED", id: conversation_id }); }),
            socket.on("conversation:removed", ({ conversation_id }) => dispatch({ type: "CONVERSATION_REMOVE", id: conversation_id })),
            // the account was deleted on another phone: this one forgets its keys and signs out
            socket.on("account:deleted", () => { keyStore.deleteLocalKeys(myId).finally(() => handleLogOut()); }),
            socket.on("presence:update", ({ user_id, online, last_seen_at }) => dispatch({ type: "PRESENCE", userId: user_id, online, lastSeenAt: last_seen_at })),
        ];
        return () => { offs.forEach((off) => off && off()); stopWatchingToken(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, refreshConversations, refreshConversation, loadHistory, sendSeen, sendDelivered, state.conversations.length]);

    const value = useMemo(() => ({ ...state, myId, refreshConversations, openConversation, closeConversation, loadOlder, sendMessage, retryMessage, discardMessage, deleteMessage, startConversation, blockUser, unblockUser,
        editMessage, forwardMessage, updateConversationSettings, readAll, ensureMessageLoaded, refreshConversation, createGroup, leaveGroup, deleteGroup, loadPresence }),
        [state, myId, refreshConversations, openConversation, closeConversation, loadOlder, sendMessage, retryMessage, discardMessage, deleteMessage, startConversation, blockUser, unblockUser,
            editMessage, forwardMessage, updateConversationSettings, readAll, ensureMessageLoaded, refreshConversation, createGroup, leaveGroup, deleteGroup, loadPresence]);
    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
    const ctx = useContext(ChatContext);
    if (!ctx) throw new Error("useChat must be used inside ChatProvider");
    return ctx;
}
