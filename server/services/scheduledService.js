const scheduledMdl = require('../models/scheduledMdl');
const messagesService = require('./messagesService');
const conversationsService = require('./conversationsService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { toIso } = require('../utils/validate.utils');
const { clientMessageForError } = require('../utils/chat.errors');
const { log, logBlock } = require('../utils/log.utils');

/*
 * Scheduled messages. The sender picks a date and time (sent as an ISO timestamp, so the moment is the
 * same in every time zone); the server stores it and a job sends due messages every minute through the
 * normal send path, so validation, block rules, receipts and the live push are exactly those of a send.
 * Each scheduled message is sent at most once: a run claims a row atomically before sending, and the
 * send uses the client id `sched-<id>`, which the messages table already keeps unique per sender.
 */
const DUE_BATCH = 50;

const toDto = (row) => ({
    scheduled_message_id: row.scheduled_message_id,
    conversation_id: row.conversation_id,
    content: row.content,
    reply_to_message_id: row.reply_to_message_id,
    send_at: toIso(row.send_at),
    status: row.status,
    failure_reason: row.failure_reason,
    sent_message_id: row.sent_message_id,
    created_at: toIso(row.created_at)
});

const changed = (senderId, conversationId) => appEvents.emit('scheduled.changed', { sender_id: Number(senderId), conversation_id: Number(conversationId) });

const loadOwnPending = async (userId, scheduledId) => {
    const [row] = await scheduledMdl.getById(scheduledId);
    // someone else's scheduled message looks exactly like a missing one
    if (!row || row.sender_id !== Number(userId)) resutils.createError('scheduledNotFound', 'Scheduled message not found.');
    return row;
};

// { content, sendAt, replyToMessageId } as scheduledVldtr.validateCreate returns them
exports.createSrvc = async (userId, conversationId, { content, sendAt, replyToMessageId: replyToId = null }) => {
    log('in scheduled createSrvc');
    await conversationsService.assertMemberSrvc(conversationId, userId);
    const replyToMessageId = await messagesService.validateReplyTarget(conversationId, replyToId, userId);

    const result = await scheduledMdl.create({ conversationId, senderId: userId, content, replyToMessageId, sendAt });
    const [row] = await scheduledMdl.getById(result.insertId);
    changed(userId, conversationId);
    return { scheduled: toDto(row) };
};

exports.listSrvc = async (userId, conversationId) => {
    log('in scheduled listSrvc');
    await conversationsService.assertMemberSrvc(conversationId, userId);
    const rows = await scheduledMdl.listForSender(conversationId, userId);
    return { scheduled: rows.map(toDto) };
};

// { content?, sendAt? } (undefined = unchanged) - only while it is still pending
exports.updateSrvc = async (userId, scheduledId, { content, sendAt }) => {
    log('in scheduled updateSrvc');
    const row = await loadOwnPending(userId, scheduledId);

    const result = await scheduledMdl.update(row.scheduled_message_id, userId, { content, sendAt });
    if (!result.affectedRows) resutils.createError('scheduledNotPending', 'This message has already been sent or cancelled.');
    const [updated] = await scheduledMdl.getById(row.scheduled_message_id);
    changed(userId, row.conversation_id);
    return { scheduled: toDto(updated) };
};

exports.cancelSrvc = async (userId, scheduledId) => {
    log('in scheduled cancelSrvc');
    const row = await loadOwnPending(userId, scheduledId);
    const result = await scheduledMdl.cancel(row.scheduled_message_id, userId);
    if (!result.affectedRows) resutils.createError('scheduledNotPending', 'This message has already been sent.');
    changed(userId, row.conversation_id);
    return { cancelled: true };
};

// one due message: claim it, send it through the normal path, record the outcome
const sendOne = async (row) => {
    const claim = await scheduledMdl.claim(row.scheduled_message_id);
    if (!claim.affectedRows) return 'skipped';       // another run took it, or it was cancelled meanwhile
    try {
        const { message } = await messagesService.createMessage(row.sender_id, {
            conversationId: row.conversation_id,
            content: row.content,
            clientMessageId: `sched-${row.scheduled_message_id}`,
            replyToMessageId: row.reply_to_message_id
        });
        await scheduledMdl.markSent(row.scheduled_message_id, message.message_id);
        return 'sent';
    } catch (error) {
        await scheduledMdl.markFailed(row.scheduled_message_id, clientMessageForError(error));
        return 'failed';
    } finally {
        changed(row.sender_id, row.conversation_id);
    }
};

// the job: everything due now. runs never overlap within one process
let running = false;
exports.runDueSrvc = async (now = new Date()) => {
    if (running) return { sent: 0, failed: 0, skipped: 0 };
    running = true;
    const counts = { sent: 0, failed: 0, skipped: 0 };
    try {
        const due = await scheduledMdl.listDue(now, DUE_BATCH);
        for (const row of due) counts[await sendOne(row)] += 1;
        if (due.length) logBlock('[scheduled messages] run:', JSON.stringify(counts));
    } finally {
        running = false;
    }
    return counts;
};

exports.toScheduledDto = toDto;
