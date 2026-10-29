const messagesMdl = require('../models/messagesMdl');
const conversationsMdl = require('../models/conversationsMdl');
const blocksMdl = require('../models/blocksMdl');
const conversationsService = require('./conversationsService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');
const { statusForError, clientMessageForError } = require('../utils/chat.errors');

// configurable limits; the defaults are the SRS values (the request limits are in validators/messagesVldtr)
const DELETE_WINDOW_MINUTES = Number(process.env.MESSAGE_DELETE_WINDOW_MINUTES) || 15;
const EDIT_WINDOW_MINUTES = Number(process.env.MESSAGE_EDIT_WINDOW_MINUTES) || 15;
const RECENT_MIN = 20;      // opening a chat: at least this many messages, even if older than the window
const RECENT_CAP = 300;     // and at most this many from the window, however busy it was

const statusOf = (row) => (row.seen_at ? 'SEEN' : row.delivered_at ? 'DELIVERED' : 'SENT');
const { nameOf } = conversationsService;
const SYSTEM = 'SYSTEM';

const toMessageDto = (row) => ({
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sender_name: nameOf(row.sender_first_nm, row.sender_last_nm),
    message_type: row.message_type,
    // group notices (message_type SYSTEM): what happened and who it happened to
    system_event: row.system_event ?? null,
    system_target_user_id: row.system_target_user_id ?? null,
    system_target_name: nameOf(row.target_first_nm, row.target_last_nm),
    content: row.is_deleted ? null : row.content,
    client_message_id: row.client_message_id,
    is_deleted: !!row.is_deleted,
    deleted_at: toIso(row.deleted_at),
    created_at: toIso(row.created_at),
    delivered_at: toIso(row.delivered_at),
    seen_at: toIso(row.seen_at),
    status: statusOf(row),
    is_edited: !!row.is_edited,
    edited_at: toIso(row.edited_at),
    is_forwarded: !!row.is_forwarded,
    // the quoted message, as the reply shows it; its text is null once that message is deleted
    reply_to: row.reply_to_message_id ? {
        message_id: row.reply_to_message_id,
        sender_id: row.reply_sender_id,
        sender_name: nameOf(row.reply_sender_first_nm, row.reply_sender_last_nm),
        content: row.reply_is_deleted ? null : row.reply_content,
        is_deleted: !!row.reply_is_deleted
    } : null
});

// master ids, cached after the first lookup: master rows do not change at runtime
const typeIds = {};
const getTypeId = async (code) => {
    if (typeIds[code]) return typeIds[code];
    const [row] = await messagesMdl.getMessageTypeByCode(code);
    if (!row) resutils.createError('DatabaseError', 'Message type master is not seeded.');
    typeIds[code] = row.message_type_id;
    return typeIds[code];
};
const getTextTypeId = () => getTypeId('TEXT');
const getSystemTypeId = () => getTypeId(SYSTEM);

const loadMessage = async (messageId) => {
    const [row] = await messagesMdl.getById(messageId);
    return row ? toMessageDto(row) : null;
};

// a group notice is the record of a membership change: it cannot be edited, deleted, forwarded or quoted
const refuseNotice = (row, what) => {
    if (row.message_type === SYSTEM) resutils.createError('notEditable', `Group notices cannot be ${what}.`);
};

/*
 * Tells senders that ticks moved. A message counts as delivered (or seen) only once every recipient
 * still waited for has it, so in a group one reader does not turn the ticks blue; in a one-to-one chat
 * that is the single recipient, exactly as before. Called after receipts change: a delivered ack, a
 * reconnect, a chat being opened, or a member leaving before they read.
 */
const announceStatus = async (messageIds, { seen = true, byUserId = null } = {}) => {
    if (!messageIds.length) return;
    const rows = await messagesMdl.getAggregateStatus([...new Set(messageIds)]);
    const userId = byUserId == null ? null : Number(byUserId);
    const seenGroups = new Map();
    for (const row of rows) {
        if (seen && row.seen_at) {
            const key = `${row.sender_id}:${row.conversation_id}`;
            const group = seenGroups.get(key) || { sender_id: row.sender_id, conversation_id: row.conversation_id, message_ids: [], seen_at: row.seen_at };
            group.message_ids.push(row.message_id);
            if (row.seen_at > group.seen_at) group.seen_at = row.seen_at;
            seenGroups.set(key, group);
        } else if (row.delivered_at) {
            appEvents.emit('message.delivered', {
                message_id: row.message_id, conversation_id: row.conversation_id, user_id: userId,
                sender_id: row.sender_id, delivered_at: toIso(row.delivered_at)
            });
        }
    }
    for (const g of seenGroups.values()) {
        appEvents.emit('conversation.seen', {
            conversation_id: g.conversation_id, user_id: userId, seen_at: toIso(g.seen_at), message_ids: g.message_ids, sender_ids: [g.sender_id]
        });
    }
};

// a message that was written outside the send path (group notices): announced like any other
const announceMessage = async (messageId) => {
    const message = await loadMessage(messageId);
    const recipientIds = await messagesMdl.getRecipientIds(messageId);
    appEvents.emit('message.created', { message, recipientIds, senderId: message.sender_id });
    return message;
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

// a reply may only quote a live message of the same conversation that the sender can see.
// replyToId is already parsed by the validator; null means the message is not a reply
const validateReplyTarget = async (conversationId, replyToId, senderId) => {
    if (replyToId === null || replyToId === undefined) return null;
    const [target] = await messagesMdl.getVisibleById(replyToId, senderId);
    if (!target || target.conversation_id !== conversationId) resutils.createError('validationFailed', 'You can only reply to a message in this conversation.');
    if (target.is_deleted) resutils.createError('validationFailed', 'You cannot reply to a deleted message.');
    if (target.message_type === SYSTEM) resutils.createError('validationFailed', 'You cannot reply to a group notice.');
    return replyToId;
};

/*
 * Send flow (SRS 3.1): identity comes from the caller (socket or jwt), never the payload.
 * validate -> membership -> block rules -> persist (one transaction) -> announce.
 * The same client_message_id from the same sender returns the first message instead of a second row.
 * Normal sends, forwards and scheduled sends all come through here, so the rules live in one place.
 */
const createMessage = async (senderId, { conversationId, content, clientMessageId = null, replyToMessageId = null, forwardedFromMessageId = null }) => {
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
            conversationId, senderId, messageTypeId: await getTextTypeId(), content, clientMessageId, recipientIds, replyToMessageId, forwardedFromMessageId
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

// { conversationId, content, clientMessageId, replyToMessageId }, as messagesVldtr.validateSend returns it
exports.sendSrvc = async (senderId, { conversationId, content, clientMessageId = null, replyToMessageId = null }) => {
    log('in sendSrvc');
    await conversationsService.assertMemberSrvc(conversationId, senderId);
    const replyTo = await validateReplyTarget(conversationId, replyToMessageId, senderId);
    return createMessage(senderId, { conversationId, content, clientMessageId, replyToMessageId: replyTo });
};

// cursor = base64url('<created_at iso>|<message_id>') of the oldest message the client has
// (messagesVldtr reads it back from the query)
const encodeCursor = (row) => Buffer.from(`${toIso(row.created_at)}|${row.message_id}`).toString('base64url');

// FR-010: newest first, ordered by (created_at, message_id); next_cursor continues backwards. only
// what the caller can see: in a group, what was sent while they were in it (and not by someone they
// blocked); someone who exited keeps reading what they received. { cursor, limit, days } come from
// messagesVldtr.validateHistory (days null: no window asked for)
exports.historySrvc = async (userId, conversationId, { cursor = null, limit, days = null }) => {
    log('in historySrvc');
    await conversationsService.assertReaderSrvc(conversationId, userId);

    // opening a chat with ?days=N: everything from the last N days (at most RECENT_CAP), so the first
    // screen holds a whole recent conversation. a quiet chat with fewer than RECENT_MIN of them gets its
    // newest messages instead, so it never opens nearly empty. older pages follow with the cursor
    if (!cursor && days) {
        const recent = await messagesMdl.getRecentHistory(conversationId, Number(userId), days, RECENT_CAP);
        if (recent.length >= RECENT_MIN) {
            // there may be older messages before the window: the next scroll asks (an empty answer ends it)
            return { messages: recent.map(toMessageDto), next_cursor: encodeCursor(recent[recent.length - 1]), has_more: true };
        }
        limit = RECENT_MIN;
    }

    const rows = await messagesMdl.getHistory(conversationId, Number(userId), cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
        messages: page.map(toMessageDto),
        next_cursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
        has_more: hasMore
    };
};

// everyone who holds a copy of the message: its sender and the people it was delivered to. edits and
// deletions go to them only, so nobody who joined a group later is sent a message they never had
const audienceOf = async (message) => [message.sender_id, ...(await messagesMdl.getRecipientIds(message.message_id))];

// FR-020..024: only the sender, still in the conversation, only inside the window measured by the database clock
exports.deleteForEveryoneSrvc = async (userId, messageId) => {
    log('in deleteForEveryoneSrvc');
    const [row] = await messagesMdl.getById(messageId);
    if (!row) resutils.createError('messageNotFound', 'Message not found.');
    if (row.sender_id !== Number(userId)) resutils.createError('notOwner', 'You can only delete your own messages.');
    refuseNotice(row, 'deleted');
    await conversationsService.assertMemberSrvc(row.conversation_id, userId);
    if (row.is_deleted) return { message: toMessageDto(row), already: true };

    const result = await messagesMdl.softDeleteWithinWindow(messageId, userId, DELETE_WINDOW_MINUTES);
    if (!result.affectedRows) {
        const [again] = await messagesMdl.getById(messageId);
        if (again?.is_deleted) return { message: toMessageDto(again), already: true };
        resutils.createError('deleteWindowExpired', `Messages can only be deleted for everyone within ${DELETE_WINDOW_MINUTES} minutes of sending.`);
    }

    const message = await loadMessage(messageId);
    appEvents.emit('message.deleted', { message, memberIds: await audienceOf(message) });
    return { message, already: false };
};

// FR-012: the recipient's client acknowledged the message. the sender hears about it once the
// message has reached everyone (in a group: every recipient)
exports.markDeliveredSrvc = async (userId, messageId) => {
    log('in markDeliveredSrvc');
    const [receipt] = await messagesMdl.getReceipt(messageId, userId);
    if (!receipt) resutils.createError('messageNotFound', 'Message not found.');
    if (receipt.delivered_at) return { changed: false, delivered_at: toIso(receipt.delivered_at) };

    await messagesMdl.markDelivered(messageId, userId);
    const [updated] = await messagesMdl.getReceipt(messageId, userId);
    await announceStatus([messageId], { seen: false, byUserId: userId });
    return { changed: true, delivered_at: toIso(updated?.delivered_at) };
};

// FR-011: a reconnecting user has, by definition, received everything waiting for them
exports.markPendingDeliveredSrvc = async (userId) => {
    log('in markPendingDeliveredSrvc');
    const { rows } = await messagesMdl.markAllPendingDelivered(userId);
    await announceStatus(rows.map((r) => r.message_id), { seen: false, byUserId: userId });
    return rows.length;
};

// FR-013 / FR-014: the recipient opened the conversation (an exited group too: they can still read it)
exports.markSeenSrvc = async (userId, conversationId) => {
    log('in markSeenSrvc');
    await conversationsService.assertReaderSrvc(conversationId, userId);

    const { seenAt, rows } = await messagesMdl.markConversationSeen(conversationId, userId);
    if (!rows.length) return { changed: 0 };
    await announceStatus(rows.map((r) => r.message_id), { byUserId: userId });
    return { changed: rows.length, seen_at: toIso(seenAt) };
};

// edit own message: only the sender, only inside the window measured by the database clock,
// whatever its ticks. the previous text is kept in message_edits_t in the same transaction
exports.editSrvc = async (userId, messageId, content) => {
    log('in editSrvc');
    const [row] = await messagesMdl.getById(messageId);
    if (!row) resutils.createError('messageNotFound', 'Message not found.');
    if (row.sender_id !== Number(userId)) resutils.createError('notOwner', 'You can only edit your own messages.');
    refuseNotice(row, 'edited');
    if (row.is_deleted) resutils.createError('notEditable', 'A deleted message cannot be edited.');
    await conversationsService.assertMemberSrvc(row.conversation_id, userId);
    if (row.content === content) return { message: toMessageDto(row), changed: false };

    const edited = await messagesMdl.editWithinWindow(messageId, userId, content, EDIT_WINDOW_MINUTES);
    if (!edited) {
        const [again] = await messagesMdl.getById(messageId);
        if (again?.is_deleted) resutils.createError('notEditable', 'A deleted message cannot be edited.');
        resutils.createError('editWindowExpired', `Messages can only be edited within ${EDIT_WINDOW_MINUTES} minutes of sending.`);
    }

    const message = await loadMessage(messageId);
    appEvents.emit('message.edited', { message, memberIds: await audienceOf(message) });
    return { message, changed: true };
};

// every version of the caller's own message, oldest first; the last one is the current text
exports.editHistorySrvc = async (userId, messageId) => {
    log('in editHistorySrvc');
    const [row] = await messagesMdl.getById(messageId);
    if (!row) resutils.createError('messageNotFound', 'Message not found.');
    if (row.sender_id !== Number(userId)) resutils.createError('notOwner', 'Only the sender can see earlier versions.');
    if (row.is_deleted) return { versions: [] };
    const edits = await messagesMdl.getEdits(messageId);
    const versions = edits.map((e, i) => ({ content: e.old_content, from: toIso(i === 0 ? row.created_at : edits[i - 1].edited_at), current: false }));
    versions.push({ content: row.content, from: toIso(edits.length ? edits[edits.length - 1].edited_at : row.created_at), current: true });
    return { versions };
};

/*
 * Forward a message the caller can see into other conversations of theirs. Every target gets its own
 * new message (sender: the caller, same text) that points back at the source through
 * forwarded_from_message_id. Targets are independent: a refused one (e.g. blocked) is reported and the
 * others still go out. Recipients only learn that it was forwarded, never where from.
 */
// targets: unique conversation ids, already checked by messagesVldtr.validateForward
exports.forwardSrvc = async (userId, messageId, targets) => {
    log('in forwardSrvc');

    // a message the caller cannot see (someone else's chat, or a group message from before they
    // joined) gets the same answer as a missing one: nothing leaks
    const [source] = await messagesMdl.getVisibleById(messageId, Number(userId));
    if (!source) resutils.createError('messageNotFound', 'Message not found.');
    try {
        await conversationsService.assertReaderSrvc(source.conversation_id, userId);
    } catch (_) {
        resutils.createError('messageNotFound', 'Message not found.');
    }
    refuseNotice(source, 'forwarded');
    if (source.is_deleted) resutils.createError('validationFailed', 'A deleted message cannot be forwarded.');

    const results = [];
    for (const conversationId of targets) {
        try {
            const { message } = await createMessage(userId, { conversationId, content: source.content, forwardedFromMessageId: messageId });
            results.push({ conversation_id: conversationId, ok: true, message });
        } catch (error) {
            const status = statusForError(error);
            results.push({ conversation_id: conversationId, ok: false, error: { statusKey: status.statusKey, message: clientMessageForError(error) } });
        }
    }
    return { results, sent: results.filter((r) => r.ok).length };
};

// text search inside one conversation, newest first; deleted messages are never searched
exports.searchSrvc = async (userId, conversationId, text, limit) => {
    log('in searchSrvc');
    await conversationsService.assertReaderSrvc(conversationId, userId);
    const rows = await messagesMdl.search(conversationId, Number(userId), text, limit);
    return { messages: rows.map(toMessageDto) };
};

// message info in a group: who has it and who has read it, each with their own time. the sender only
exports.receiptsSrvc = async (userId, messageId) => {
    log('in receiptsSrvc');
    const [row] = await messagesMdl.getById(messageId);
    if (!row) resutils.createError('messageNotFound', 'Message not found.');
    if (row.sender_id !== Number(userId)) resutils.createError('notOwner', 'Only the sender can see who received a message.');
    const receipts = await messagesMdl.listReceipts(messageId);
    return {
        receipts: receipts.map((r) => ({
            user_id: r.user_id, name: nameOf(r.first_nm, r.last_nm),
            delivered_at: toIso(r.delivered_at), seen_at: toIso(r.seen_at), left_group: !!r.excluded_at
        }))
    };
};

// read all: every conversation of the caller with unseen messages, archived ones included. each one
// is marked in its own transaction (exactly like opening it), so a failure in one leaves the others
// marked and nothing half-done
exports.markAllSeenSrvc = async (userId) => {
    log('in markAllSeenSrvc');
    const rows = await conversationsMdl.listWithUnread(userId);
    let conversations = 0;
    let messages = 0;
    for (const { conversation_id: conversationId } of rows) {
        const { changed } = await exports.markSeenSrvc(userId, conversationId);
        if (changed) { conversations += 1; messages += changed; }
    }
    return { conversations, messages };
};

exports.createMessage = createMessage;
exports.announceMessage = announceMessage;
exports.announceStatus = announceStatus;
exports.getSystemTypeId = getSystemTypeId;
exports.validateReplyTarget = validateReplyTarget;
exports.toMessageDto = toMessageDto;
exports.DELETE_WINDOW_MINUTES = DELETE_WINDOW_MINUTES;
