const messagesMdl = require('../models/messagesMdl');
const conversationsMdl = require('../models/conversationsMdl');
const blocksMdl = require('../models/blocksMdl');
const conversationsService = require('./conversationsService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { parseId, toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

// configurable limits; the defaults are the SRS values
const MAX_LENGTH = Number(process.env.MESSAGE_MAX_LENGTH) || 2000;
const DELETE_WINDOW_MINUTES = Number(process.env.MESSAGE_DELETE_WINDOW_MINUTES) || 15;
const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

const statusOf = (row) => (row.seen_at ? 'SEEN' : row.delivered_at ? 'DELIVERED' : 'SENT');

const toMessageDto = (row) => ({
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    message_type: row.message_type,
    content: row.is_deleted ? null : row.content,
    client_message_id: row.client_message_id,
    is_deleted: !!row.is_deleted,
    deleted_at: toIso(row.deleted_at),
    created_at: toIso(row.created_at),
    delivered_at: toIso(row.delivered_at),
    seen_at: toIso(row.seen_at),
    status: statusOf(row)
});

let textTypeId = null;
const getTextTypeId = async () => {
    if (textTypeId) return textTypeId;
    const [row] = await messagesMdl.getMessageTypeByCode('TEXT');
    if (!row) resutils.createError('DatabaseError', 'Message type master is not seeded.');
    textTypeId = row.message_type_id;
    return textTypeId;
};

const loadMessage = async (messageId) => {
    const [row] = await messagesMdl.getById(messageId);
    return row ? toMessageDto(row) : null;
};

// FR-007 / FR-027: text only, trimmed, non-empty, bounded
const validateContent = (content) => {
    if (typeof content !== 'string') resutils.createError('validationFailed', 'Message content must be text.');
    const text = content.trim();
    if (!text) resutils.createError('validationFailed', 'Message cannot be empty.');
    if (text.length > MAX_LENGTH) resutils.createError('validationFailed', `Message cannot exceed ${MAX_LENGTH} characters.`);
    return text;
};

const validateClientMessageId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 36 || !/^[A-Za-z0-9_-]+$/.test(value)) {
        resutils.createError('validationFailed', 'client_message_id must be up to 36 url-safe characters.');
    }
    return value;
};

// a lost lock race (deadlock victim or lock wait timeout) is retried once before it is reported
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const insertWithRetry = async (args, attempt = 1) => {
    try {
        return await messagesMdl.insertMessageWithReceipts(args);
    } catch (error) {
        if (RETRYABLE.has(error.code) && attempt < 3) return insertWithRetry(args, attempt + 1);
        throw error;
    }
};

/*
 * Send flow (SRS 3.1): identity comes from the caller (socket or jwt), never the payload.
 * validate -> membership -> block rules -> persist (one transaction) -> announce.
 * The same client_message_id from the same sender returns the first message instead of a second row.
 */
exports.sendSrvc = async (senderId, payload = {}) => {
    log('in sendSrvc');
    const conversationId = parseId(payload.conversation_id, 'Conversation id');
    const content = validateContent(payload.content);
    const clientMessageId = validateClientMessageId(payload.client_message_id);

    const membership = await conversationsService.assertMemberSrvc(conversationId, senderId);

    if (clientMessageId) {
        const [existing] = await messagesMdl.getBySenderAndClientId(senderId, clientMessageId);
        if (existing && existing.conversation_id === conversationId) return { message: toMessageDto(existing), duplicate: true };
    }

    const memberIds = await conversationsMdl.getMemberIds(conversationId);
    let recipientIds = memberIds.filter((id) => id !== Number(senderId));

    // FR-016 / FR-019: a recipient who blocked the sender refuses the message. in a one-to-one
    // chat that rejects the send; in a group the blocker is simply left out
    const blockers = (await blocksMdl.recipientsBlockingSender(senderId, recipientIds)).map((r) => r.blocker_id);
    if (blockers.length) {
        if (membership.type_code === 'ONE_TO_ONE') resutils.createError('blocked', 'You cannot send messages to this user.');
        recipientIds = recipientIds.filter((id) => !blockers.includes(id));
    }

    let messageId;
    try {
        messageId = await insertWithRetry({
            conversationId, senderId, messageTypeId: await getTextTypeId(), content, clientMessageId, recipientIds
        });
    } catch (error) {
        // the same client id raced in twice: hand back the row that won
        if (error.code === 'ER_DUP_ENTRY' && clientMessageId) {
            const [existing] = await messagesMdl.getBySenderAndClientId(senderId, clientMessageId);
            if (existing) return { message: toMessageDto(existing), duplicate: true };
        }
        throw error;
    }

    const message = await loadMessage(messageId);
    appEvents.emit('message.created', { message, recipientIds, senderId: Number(senderId) });
    return { message, duplicate: false };
};

// cursor = base64url('<created_at iso>|<message_id>') of the oldest message the client has
const encodeCursor = (row) => Buffer.from(`${toIso(row.created_at)}|${row.message_id}`).toString('base64url');
const decodeCursor = (value) => {
    if (!value) return null;
    try {
        const [iso, id] = Buffer.from(String(value), 'base64url').toString('utf8').split('|');
        const createdAt = new Date(iso);
        const messageId = Number(id);
        if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(messageId) || messageId < 1) throw new Error('bad cursor');
        return { createdAt, messageId };
    } catch (_) {
        return resutils.createError('invalidCursor', 'Invalid cursor.');
    }
};

// FR-010: newest first, ordered by (created_at, message_id); next_cursor continues backwards
exports.historySrvc = async (userId, conversationIdRaw, cursorRaw, limitRaw) => {
    log('in historySrvc');
    const conversationId = parseId(conversationIdRaw, 'Conversation id');
    await conversationsService.assertMemberSrvc(conversationId, userId);

    let limit = Number.parseInt(limitRaw, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_PAGE;
    if (limit > MAX_PAGE) limit = MAX_PAGE;
    const cursor = decodeCursor(cursorRaw);

    const rows = await messagesMdl.getHistory(conversationId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
        messages: page.map(toMessageDto),
        next_cursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
        has_more: hasMore
    };
};

// FR-020..024: only the sender, only inside the window measured by the database clock
exports.deleteForEveryoneSrvc = async (userId, messageIdRaw) => {
    log('in deleteForEveryoneSrvc');
    const messageId = parseId(messageIdRaw, 'Message id');
    const [row] = await messagesMdl.getById(messageId);
    if (!row) resutils.createError('messageNotFound', 'Message not found.');
    if (row.sender_id !== Number(userId)) resutils.createError('notOwner', 'You can only delete your own messages.');
    if (row.is_deleted) return { message: toMessageDto(row), already: true };

    const result = await messagesMdl.softDeleteWithinWindow(messageId, userId, DELETE_WINDOW_MINUTES);
    if (!result.affectedRows) {
        const [again] = await messagesMdl.getById(messageId);
        if (again?.is_deleted) return { message: toMessageDto(again), already: true };
        resutils.createError('deleteWindowExpired', `Messages can only be deleted for everyone within ${DELETE_WINDOW_MINUTES} minutes of sending.`);
    }

    const message = await loadMessage(messageId);
    const memberIds = await conversationsMdl.getMemberIds(message.conversation_id);
    appEvents.emit('message.deleted', { message, memberIds });
    return { message, already: false };
};

// FR-012: the recipient's client acknowledged the message
exports.markDeliveredSrvc = async (userId, messageIdRaw) => {
    log('in markDeliveredSrvc');
    const messageId = parseId(messageIdRaw, 'Message id');
    const [receipt] = await messagesMdl.getReceipt(messageId, userId);
    if (!receipt) resutils.createError('messageNotFound', 'Message not found.');
    if (receipt.delivered_at) return { changed: false, delivered_at: toIso(receipt.delivered_at) };

    await messagesMdl.markDelivered(messageId, userId);
    const [updated] = await messagesMdl.getReceipt(messageId, userId);
    const deliveredAt = toIso(updated?.delivered_at);
    appEvents.emit('message.delivered', {
        message_id: messageId, conversation_id: receipt.conversation_id, user_id: Number(userId),
        sender_id: receipt.sender_id, delivered_at: deliveredAt
    });
    return { changed: true, delivered_at: deliveredAt };
};

// FR-011: a reconnecting user has, by definition, received everything waiting for them
exports.markPendingDeliveredSrvc = async (userId) => {
    log('in markPendingDeliveredSrvc');
    const { deliveredAt, rows } = await messagesMdl.markAllPendingDelivered(userId);
    for (const row of rows) {
        appEvents.emit('message.delivered', {
            message_id: row.message_id, conversation_id: row.conversation_id, user_id: Number(userId),
            sender_id: row.sender_id, delivered_at: toIso(deliveredAt)
        });
    }
    return rows.length;
};

// FR-013 / FR-014: the recipient opened the conversation
exports.markSeenSrvc = async (userId, conversationIdRaw) => {
    log('in markSeenSrvc');
    const conversationId = parseId(conversationIdRaw, 'Conversation id');
    await conversationsService.assertMemberSrvc(conversationId, userId);

    const { seenAt, rows } = await messagesMdl.markConversationSeen(conversationId, userId);
    if (!rows.length) return { changed: 0 };
    const senderIds = [...new Set(rows.map((r) => r.sender_id))];
    appEvents.emit('conversation.seen', {
        conversation_id: conversationId, user_id: Number(userId), seen_at: toIso(seenAt),
        message_ids: rows.map((r) => r.message_id), sender_ids: senderIds
    });
    return { changed: rows.length, seen_at: toIso(seenAt) };
};

exports.toMessageDto = toMessageDto;
exports.MAX_LENGTH = MAX_LENGTH;
exports.DELETE_WINDOW_MINUTES = DELETE_WINDOW_MINUTES;
