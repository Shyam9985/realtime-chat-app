const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// one message with its aggregated receipt state. delivered_at / seen_at are set only once EVERY
// recipient still waited for has delivered / seen (for a one-to-one chat that is the single
// recipient; in a group, someone who left before seeing it is no longer waited for).
// deleted messages come back with content null: the original text never leaves the server (FR-023).
// a reply carries a preview of the message it quotes (also null when that one was deleted); a forwarded
// copy only says that it was forwarded, never where from. names come along so a group chat can say
// who wrote what, and a notice who it is about
const MESSAGE_SELECT = `select m.message_id, m.conversation_id, m.sender_id, mt.type_code as message_type,
            case when m.is_deleted = 1 then null else m.content end as content,
            m.client_message_id, m.is_deleted, m.deleted_at, m.created_at, m.is_edited, m.edited_at,
            (m.forwarded_from_message_id is not null) as is_forwarded,
            su.first_nm as sender_first_nm, su.last_nm as sender_last_nm,
            m.system_event, m.system_target_user_id, tu.first_nm as target_first_nm, tu.last_nm as target_last_nm,
            m.reply_to_message_id, rm.sender_id as reply_sender_id, rm.is_deleted as reply_is_deleted,
            case when rm.is_deleted = 1 then null else rm.content end as reply_content,
            ru.first_nm as reply_sender_first_nm, ru.last_nm as reply_sender_last_nm,
            case when count(r.message_receipt_id) > 0 and sum(r.delivered_at is null) = 0 then max(r.delivered_at) end as delivered_at,
            case when count(r.message_receipt_id) > 0 and sum(r.seen_at is null) = 0 then max(r.seen_at) end as seen_at
        from messages_lst_t m
        join message_type_master_t mt on mt.message_type_id = m.message_type_id
        join users_lst_t su on su.user_id = m.sender_id
        left join users_lst_t tu on tu.user_id = m.system_target_user_id
        left join messages_lst_t rm on rm.message_id = m.reply_to_message_id
        left join users_lst_t ru on ru.user_id = rm.sender_id
        left join message_receipts_t r on r.message_id = m.message_id and r.is_active = 1 and r.excluded_at is null`;
const MESSAGE_GROUP = `group by m.message_id, m.conversation_id, m.sender_id, mt.type_code, m.content, m.client_message_id, m.is_deleted,
        m.deleted_at, m.created_at, m.is_edited, m.edited_at, m.forwarded_from_message_id, su.first_nm, su.last_nm,
        m.system_event, m.system_target_user_id, tu.first_nm, tu.last_nm,
        m.reply_to_message_id, rm.sender_id, rm.is_deleted, rm.content, ru.first_nm, ru.last_nm`;

// who may see a message: its sender, and everyone it was delivered to (a receipt). receipts are
// written for the members at the moment of sending, minus anyone who blocked the sender, so this one
// rule covers joining a group later, leaving it, rejoining, and blocking inside a group
const VISIBLE_TO = `and (m.sender_id = ? or exists (select 1 from message_receipts_t v
            where v.message_id = m.message_id and v.user_id = ? and v.is_active = 1))`;

exports.getMessageTypeByCode = (code) => {
    log('in getMessageTypeByCode');
    const qry = 'select message_type_id from message_type_master_t where type_code = ? and is_active = 1';
    return dbutils.executeQuery(qry, [code], 'get message type');
};

exports.getById = (messageId) => {
    log('in getById (message)');
    const qry = `${MESSAGE_SELECT} where m.message_id = ? and m.is_active = 1 ${MESSAGE_GROUP}`;
    return dbutils.executeQuery(qry, [messageId], 'get message by id');
};

// idempotent sends: the same client_message_id from the same sender maps to the same row
exports.getBySenderAndClientId = (senderId, clientMessageId) => {
    log('in getBySenderAndClientId');
    const qry = `${MESSAGE_SELECT} where m.sender_id = ? and m.client_message_id = ? and m.is_active = 1 ${MESSAGE_GROUP}`;
    return dbutils.executeQuery(qry, [senderId, clientMessageId], 'get message by client id');
};

// the message row, one receipt per recipient, and the last-message pointers: the conversation's and
// those of everyone who can see it (the sender and the recipients). runs inside the caller's
// transaction, which must already hold the conversation row lock. seen: the receipts are written as
// already read (group notices: they make the notice visible but never count as unread)
const insertWithReceipts = async (connection, {
    conversationId, senderId, messageTypeId, content, clientMessageId = null, recipientIds,
    replyToMessageId = null, forwardedFromMessageId = null, systemEvent = null, systemTargetUserId = null, seen = false
}) => {
    const [result] = await connection.execute(
        `insert into messages_lst_t (conversation_id, sender_id, message_type_id, system_event, system_target_user_id, content, client_message_id, reply_to_message_id, forwarded_from_message_id)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, senderId, messageTypeId, systemEvent, systemTargetUserId, content, clientMessageId, replyToMessageId, forwardedFromMessageId]);
    const messageId = result.insertId;

    if (recipientIds.length) {
        const marks = recipientIds.map(() => (seen ? '(?, ?, now(3), now(3))' : '(?, ?)')).join(', ');
        const params = recipientIds.flatMap((userId) => [messageId, userId]);
        await connection.execute(`insert into message_receipts_t (message_id, user_id${seen ? ', delivered_at, seen_at' : ''}) values ${marks}`, params);
    }

    await connection.execute(
        `update conversations_lst_t c join messages_lst_t m on m.message_id = ?
            set c.last_message_id = m.message_id, c.last_message_at = m.created_at
            where c.conversation_id = ?`,
        [messageId, conversationId]);
    const viewers = [senderId, ...recipientIds];
    await connection.execute(
        `update conversation_members_t set last_message_id = ? where conversation_id = ? and user_id in (${viewers.map(() => '?').join(', ')})`,
        [messageId, conversationId, ...viewers]);
    return messageId;
};

// FR-008 / ACID: the message, its receipts and the last-message pointers are written in one
// transaction. nothing is announced until this commits
exports.insertMessageWithReceipts = (args) => {
    log('in insertMessageWithReceipts');
    return dbutils.executeTransaction(async (connection) => {
        // the insert below takes a shared lock on the conversation row for its foreign key check and
        // the update at the end needs an exclusive one. two concurrent sends in the same conversation
        // would deadlock on that upgrade, so take the exclusive lock up front: sends to one
        // conversation now queue in commit order, which also keeps created_at monotonic per chat
        await connection.execute('select conversation_id from conversations_lst_t where conversation_id = ? for update', [args.conversationId]);
        return insertWithReceipts(connection, args);
    }, 'insert message with receipts');
};

exports.insertWithReceipts = insertWithReceipts;

// keyset pagination, newest first: everything strictly before the cursor (created_at, message_id),
// limited to what the viewer may see. limit is validated by the service and inlined because LIMIT
// does not take a bound parameter here
exports.getHistory = (conversationId, viewerId, cursor, limit) => {
    log('in getHistory');
    const where = cursor
        ? 'and (m.created_at < ? or (m.created_at = ? and m.message_id < ?))'
        : '';
    const params = [conversationId, viewerId, viewerId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.messageId] : [])];
    const qry = `${MESSAGE_SELECT} where m.conversation_id = ? and m.is_active = 1 ${VISIBLE_TO} ${where} ${MESSAGE_GROUP}
        order by m.created_at desc, m.message_id desc limit ${Number(limit)}`;
    return dbutils.executeQuery(qry, params, 'get history');
};

// one message, only when the viewer may see it (else nothing, as if it did not exist)
exports.getVisibleById = (messageId, viewerId) => {
    log('in getVisibleById');
    const qry = `${MESSAGE_SELECT} where m.message_id = ? and m.is_active = 1 ${VISIBLE_TO} ${MESSAGE_GROUP}`;
    return dbutils.executeQuery(qry, [messageId, viewerId, viewerId], 'get visible message');
};

// everyone a message was delivered to (its receipts), for announcing it, its edits and its deletion
exports.getRecipientIds = async (messageId) => {
    log('in getRecipientIds');
    const rows = await dbutils.executeQuery('select user_id from message_receipts_t where message_id = ? and is_active = 1', [messageId], 'get recipient ids');
    return rows.map((r) => r.user_id);
};

// each message's aggregated ticks (the same rule as MESSAGE_SELECT), to tell senders when they moved
exports.getAggregateStatus = (messageIds) => {
    log('in getAggregateStatus');
    const marks = messageIds.map(() => '?').join(', ');
    const qry = `select m.message_id, m.sender_id, m.conversation_id,
            case when count(r.message_receipt_id) > 0 and sum(r.delivered_at is null) = 0 then max(r.delivered_at) end as delivered_at,
            case when count(r.message_receipt_id) > 0 and sum(r.seen_at is null) = 0 then max(r.seen_at) end as seen_at
        from messages_lst_t m
        left join message_receipts_t r on r.message_id = m.message_id and r.is_active = 1 and r.excluded_at is null
        where m.message_id in (${marks})
        group by m.message_id, m.sender_id, m.conversation_id`;
    return dbutils.executeQuery(qry, messageIds, 'aggregate message status');
};

// message info in a group: every recipient with their own delivered / read times
exports.listReceipts = (messageId) => {
    log('in listReceipts');
    const qry = `select r.user_id, u.first_nm, u.last_nm, r.delivered_at, r.seen_at, r.excluded_at
        from message_receipts_t r join users_lst_t u on u.user_id = r.user_id
        where r.message_id = ? and r.is_active = 1
        order by r.seen_at is null, r.seen_at, r.delivered_at is null, r.delivered_at, u.first_nm, u.user_id`;
    return dbutils.executeQuery(qry, [messageId], 'list message receipts');
};

// FR-020/021: the window is evaluated by the database clock against the persisted created_at,
// never by anything the client sent. affectedRows 0 means not owner, already deleted, or too old
exports.softDeleteWithinWindow = (messageId, senderId, windowMinutes) => {
    log('in softDeleteWithinWindow');
    const qry = `update messages_lst_t set is_deleted = 1, deleted_at = now(3)
        where message_id = ? and sender_id = ? and is_deleted = 0 and is_active = 1
          and created_at >= now(3) - interval ${Number(windowMinutes)} minute`;
    return dbutils.executeQuery(qry, [messageId, senderId], 'soft delete message');
};

// ---- edits ----

// the window is checked by the database clock against the stored created_at, inside the same
// transaction that saves the previous text, so the history and the message can never disagree.
// returns false when the message is not the sender's, is deleted, or is too old
exports.editWithinWindow = (messageId, senderId, newContent, windowMinutes) => {
    log('in editWithinWindow');
    return dbutils.executeTransaction(async (connection) => {
        const [[row]] = await connection.execute(
            `select content from messages_lst_t
                where message_id = ? and sender_id = ? and is_deleted = 0 and is_active = 1
                  and created_at >= now(3) - interval ${Number(windowMinutes)} minute for update`,
            [messageId, senderId]);
        if (!row) return false;
        await connection.execute('insert into message_edits_t (message_id, old_content, edited_by) values (?, ?, ?)', [messageId, row.content, senderId]);
        await connection.execute('update messages_lst_t set content = ?, is_edited = 1, edited_at = now(3) where message_id = ?', [newContent, messageId]);
        return true;
    }, 'edit message');
};

// earlier versions of a message, oldest first (each row is the text as it was before that edit)
exports.getEdits = (messageId) => {
    log('in getEdits');
    const qry = 'select old_content, edited_at from message_edits_t where message_id = ? and is_active = 1 order by edited_at, message_edit_id';
    return dbutils.executeQuery(qry, [messageId], 'get message edits');
};

// ---- search ----

// messages in one conversation containing the text, newest first, among those the viewer may see.
// words of 3+ characters use the full-text index to narrow the rows; the LIKE then matches the exact
// text (and covers short terms). deleted messages and group notices are never searched
exports.search = (conversationId, viewerId, text, limit) => {
    log('in search messages');
    const like = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length >= 3);
    const fulltext = words.length ? 'and match(m.content) against (? in boolean mode)' : '';
    const params = [conversationId, viewerId, viewerId, ...(words.length ? [words.map((w) => `+${w}*`).join(' ')] : []), like];
    const qry = `${MESSAGE_SELECT} where m.conversation_id = ? and m.is_active = 1 and m.is_deleted = 0 and mt.type_code <> 'SYSTEM' ${VISIBLE_TO} ${fulltext}
          and m.content like ? ${MESSAGE_GROUP} order by m.created_at desc, m.message_id desc limit ${Number(limit)}`;
    return dbutils.executeQuery(qry, params, 'search messages');
};

// ---- receipts ----

// the recipient's receipt for a message, with the sender and conversation for the notification
exports.getReceipt = (messageId, userId) => {
    log('in getReceipt');
    const qry = `select r.message_receipt_id, r.message_id, r.user_id, r.delivered_at, r.seen_at, m.sender_id, m.conversation_id
        from message_receipts_t r join messages_lst_t m on m.message_id = r.message_id
        where r.message_id = ? and r.user_id = ? and r.is_active = 1`;
    return dbutils.executeQuery(qry, [messageId, userId], 'get receipt');
};

exports.markDelivered = (messageId, userId) => {
    log('in markDelivered');
    const qry = 'update message_receipts_t set delivered_at = now(3) where message_id = ? and user_id = ? and delivered_at is null and is_active = 1';
    return dbutils.executeQuery(qry, [messageId, userId], 'mark delivered');
};

// everything waiting for this user (offline recovery on connect). returns what it marked so the
// senders can be told, one transaction so the list and the update agree
exports.markAllPendingDelivered = (userId) => {
    log('in markAllPendingDelivered');
    return dbutils.executeTransaction(async (connection) => {
        const [pending] = await connection.execute(
            `select r.message_id, m.sender_id, m.conversation_id from message_receipts_t r
                join messages_lst_t m on m.message_id = r.message_id
                where r.user_id = ? and r.delivered_at is null and r.is_active = 1 for update`,
            [userId]);
        if (!pending.length) return { deliveredAt: null, rows: [] };
        const ids = pending.map((p) => p.message_id);
        const marks = ids.map(() => '?').join(', ');
        await connection.execute(
            `update message_receipts_t set delivered_at = now(3) where user_id = ? and delivered_at is null and message_id in (${marks})`,
            [userId, ...ids]);
        const [[{ now }]] = await connection.execute('select now(3) as now');
        return { deliveredAt: now, rows: pending };
    }, 'mark all pending delivered');
};

// FR-013: the recipient viewed the conversation. marks every unseen receipt of theirs in it
// (delivered too, in case the delivered ack never arrived) and moves their read pointer
exports.markConversationSeen = (conversationId, userId) => {
    log('in markConversationSeen');
    return dbutils.executeTransaction(async (connection) => {
        const [unseen] = await connection.execute(
            `select r.message_id, m.sender_id from message_receipts_t r
                join messages_lst_t m on m.message_id = r.message_id
                where r.user_id = ? and r.seen_at is null and r.is_active = 1 and m.conversation_id = ? for update`,
            [userId, conversationId]);
        if (!unseen.length) return { seenAt: null, rows: [] };
        const ids = unseen.map((u) => u.message_id);
        const marks = ids.map(() => '?').join(', ');
        await connection.execute(
            `update message_receipts_t set seen_at = now(3), delivered_at = coalesce(delivered_at, now(3))
                where user_id = ? and seen_at is null and message_id in (${marks})`,
            [userId, ...ids]);
        await connection.execute(
            `update conversation_members_t set last_read_message_id = greatest(ifnull(last_read_message_id, 0), ?)
                where conversation_id = ? and user_id = ?`,
            [Math.max(...ids), conversationId, userId]);
        const [[{ now }]] = await connection.execute('select now(3) as now');
        return { seenAt: now, rows: unseen };
    }, 'mark conversation seen');
};
