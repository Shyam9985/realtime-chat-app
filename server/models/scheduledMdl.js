const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

/*
 * Messages waiting for their send time. status: PENDING -> SENDING -> SENT | FAILED, or CANCELLED.
 * SENDING is a claim: a row moves PENDING -> SENDING in one conditional update, so only one run of
 * the job (or one server instance) gets to send it. A claim older than a few minutes (the server
 * stopped mid-send) is reclaimed; the send itself is idempotent, so a reclaim never sends twice.
 */
const COLUMNS = `scheduled_message_id, conversation_id, sender_id, content, reply_to_message_id, send_at, status,
    sent_message_id, failure_reason, created_at, updated_at`;

exports.create = ({ conversationId, senderId, content, replyToMessageId, sendAt }) => {
    log('in scheduled create');
    const qry = `insert into scheduled_messages_t (conversation_id, sender_id, content, reply_to_message_id, send_at)
        values (?, ?, ?, ?, ?)`;
    return dbutils.executeQuery(qry, [conversationId, senderId, content, replyToMessageId, sendAt], 'create scheduled message');
};

exports.getById = (scheduledId) => {
    log('in scheduled getById');
    const qry = `select ${COLUMNS} from scheduled_messages_t where scheduled_message_id = ? and is_active = 1`;
    return dbutils.executeQuery(qry, [scheduledId], 'get scheduled message');
};

// the sender's own pending (and failed, so they can see why) messages in one conversation
exports.listForSender = (conversationId, senderId) => {
    log('in scheduled listForSender');
    const qry = `select ${COLUMNS} from scheduled_messages_t
        where conversation_id = ? and sender_id = ? and is_active = 1 and status in ('PENDING', 'SENDING', 'FAILED')
        order by send_at, scheduled_message_id`;
    return dbutils.executeQuery(qry, [conversationId, senderId], 'list scheduled messages');
};

// only a pending message of this sender can change; affectedRows 0 otherwise
exports.update = (scheduledId, senderId, { content, sendAt }) => {
    log('in scheduled update');
    const sets = [];
    const params = [];
    if (content !== undefined) { sets.push('content = ?'); params.push(content); }
    if (sendAt !== undefined) { sets.push('send_at = ?'); params.push(sendAt); }
    const qry = `update scheduled_messages_t set ${sets.join(', ')}
        where scheduled_message_id = ? and sender_id = ? and status = 'PENDING' and is_active = 1`;
    return dbutils.executeQuery(qry, [...params, scheduledId, senderId], 'update scheduled message');
};

exports.cancel = (scheduledId, senderId) => {
    log('in scheduled cancel');
    const qry = `update scheduled_messages_t set status = 'CANCELLED'
        where scheduled_message_id = ? and sender_id = ? and status in ('PENDING', 'FAILED') and is_active = 1`;
    return dbutils.executeQuery(qry, [scheduledId, senderId], 'cancel scheduled message');
};

// a claim older than this is treated as abandoned (the server stopped mid-send)
const STALE_CLAIM_MINUTES = 5;

// due rows (and stale claims) as candidates. `now` comes from node, the same clock and time zone
// conversion that stored send_at; the stale check compares two database times, so it uses now(3)
exports.listDue = (now, limit) => {
    log('in scheduled listDue');
    const qry = `select ${COLUMNS} from scheduled_messages_t
        where is_active = 1 and ((status = 'PENDING' and send_at <= ?)
          or (status = 'SENDING' and updated_at < now(3) - interval ${STALE_CLAIM_MINUTES} minute))
        order by send_at, scheduled_message_id limit ${Number(limit)}`;
    return dbutils.executeQuery(qry, [now], 'list due scheduled messages');
};

// atomic claim; affectedRows 1 means this run owns the row
exports.claim = (scheduledId) => {
    log('in scheduled claim');
    const qry = `update scheduled_messages_t set status = 'SENDING', updated_at = now(3)
        where scheduled_message_id = ? and is_active = 1
          and (status = 'PENDING' or (status = 'SENDING' and updated_at < now(3) - interval ${STALE_CLAIM_MINUTES} minute))`;
    return dbutils.executeQuery(qry, [scheduledId], 'claim scheduled message');
};

exports.markSent = (scheduledId, messageId) => {
    log('in scheduled markSent');
    const qry = `update scheduled_messages_t set status = 'SENT', sent_message_id = ?, failure_reason = null where scheduled_message_id = ?`;
    return dbutils.executeQuery(qry, [messageId, scheduledId], 'mark scheduled sent');
};

exports.markFailed = (scheduledId, reason) => {
    log('in scheduled markFailed');
    const qry = `update scheduled_messages_t set status = 'FAILED', failure_reason = ? where scheduled_message_id = ?`;
    return dbutils.executeQuery(qry, [String(reason || 'Could not send.').slice(0, 255), scheduledId], 'mark scheduled failed');
};
