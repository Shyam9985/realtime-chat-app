import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import * as chatApi from "../services/chat.service";
import * as socket from "../services/socket.service";
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

const initialState = { conversations: [], conversationsStatus: "idle", conversationsError: null, threads: {}, socketStatus: "disconnected" };
const emptyThread = () => ({ messages: [], nextCursor: null, hasMore: true, status: "idle", error: null });

const ts = (v) => (v ? new Date(v).getTime() : 0);
const sortConversations = (list) => [...list].sort((a, b) => (ts(b.last_message_at || b.created_at) - ts(a.last_message_at || a.created_at)) || (b.conversation_id - a.conversation_id));
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
                    last_message: { message_id: message.message_id, sender_id: message.sender_id, content: message.content, is_deleted: message.is_deleted, created_at: message.created_at, status: message.status },
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
        case "MESSAGE_PATCH": { const t = state.threads[action.conversationId]; if (!t) return state; return { ...state, threads: { ...state.threads, [action.conversationId]: { ...t, messages: patch(t.messages, action.predicate, action.fields) } } }; }
        case "MESSAGE_REMOVE": { const t = state.threads[action.conversationId]; if (!t) return state; return { ...state, threads: { ...state.threads, [action.conversationId]: { ...t, messages: t.messages.filter((m) => !action.predicate(m)) } } }; }
        case "RESET": return initialState;
        default: return state;
    }
}

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16); }));

export function ChatProvider({ children }) {
    const { status: authStatus, user } = useAuth();
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
            const page = await chatApi.getHistory(conversationId, cursor);
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

    const sendMessage = useCallback(async (conversationId, text) => {
        const content = text.trim();
        if (!content) return;
        const clientMessageId = uuid();
        dispatch({ type: "MESSAGE_MERGE", message: { message_id: null, client_message_id: clientMessageId, conversation_id: conversationId, sender_id: myId, content, is_deleted: false, created_at: new Date().toISOString(), status: "SENDING", local: true } });
        try {
            const result = socket.isConnected()
                ? await socket.emitWithAck("message:send", { conversation_id: conversationId, content, client_message_id: clientMessageId })
                : await chatApi.sendMessage(conversationId, content, clientMessageId);
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
        return sendMessage(message.conversation_id, message.content);
    }, [sendMessage]);

    const discardMessage = useCallback((message) => dispatch({ type: "MESSAGE_REMOVE", conversationId: message.conversation_id, predicate: (m) => m.client_message_id === message.client_message_id }), []);

    const deleteMessage = useCallback(async (message) => {
        const result = await chatApi.deleteMessage(message.message_id);
        dispatch({ type: "MESSAGE_MERGE", message: result.message });
        return result.message;
    }, []);

    const startConversation = useCallback(async (userId) => {
        const { conversation } = await chatApi.getOrCreateConversation(userId);
        dispatch({ type: "CONVERSATION_UPSERT", conversation });
        return conversation;
    }, []);

    const setBlockedFlag = (userId, blocked) => state.conversations.filter((c) => c.other_user?.user_id === userId).forEach((c) => dispatch({ type: "CONVERSATION_PATCH", id: c.conversation_id, fields: { blocked_by_me: blocked } }));
    const blockUser = useCallback(async (userId) => { await chatApi.blockUser(userId); setBlockedFlag(userId, true); }, [state.conversations]);     // eslint-disable-line react-hooks/exhaustive-deps
    const unblockUser = useCallback(async (userId) => { await chatApi.unblockUser(userId); setBlockedFlag(userId, false); }, [state.conversations]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (authStatus !== "signedIn") { dispatch({ type: "RESET" }); return undefined; }
        socket.connect();
        refreshConversations();
        const offs = [
            socket.onStatus((s) => {
                dispatch({ type: "SOCKET_STATUS", status: s });
                if (s === "connected") { refreshConversations(); if (active.current) { loadHistory(active.current, null, true); sendSeen(active.current); } }
            }),
            socket.on("message:new", (message) => {
                const isOpen = active.current === message.conversation_id;
                dispatch({ type: "MESSAGE_MERGE", message });
                if (state.conversations.some((c) => c.conversation_id === message.conversation_id)) dispatch({ type: "CONVERSATION_PREVIEW", message, incrementUnread: !isOpen });
                else refreshConversations();
                sendDelivered(message.message_id);
                if (isOpen) sendSeen(message.conversation_id);
            }),
            socket.on("message:sent", (message) => { dispatch({ type: "MESSAGE_MERGE", message }); dispatch({ type: "CONVERSATION_PREVIEW", message, incrementUnread: false }); }),
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
        ];
        return () => { offs.forEach((off) => off && off()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, refreshConversations, loadHistory, sendSeen, sendDelivered, state.conversations.length]);

    const value = useMemo(() => ({ ...state, myId, refreshConversations, openConversation, closeConversation, loadOlder, sendMessage, retryMessage, discardMessage, deleteMessage, startConversation, blockUser, unblockUser }),
        [state, myId, refreshConversations, openConversation, closeConversation, loadOlder, sendMessage, retryMessage, discardMessage, deleteMessage, startConversation, blockUser, unblockUser]);
    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
    const ctx = useContext(ChatContext);
    if (!ctx) throw new Error("useChat must be used inside ChatProvider");
    return ctx;
}
