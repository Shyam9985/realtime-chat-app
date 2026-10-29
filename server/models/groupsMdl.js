const dbutils = require('../utils/db.utils');
const { insertWithReceipts } = require('./messagesMdl');
const { log } = require('../utils/log.utils');

/*
 * Group membership changes. Each one is a single transaction that first locks the conversation row
 * and its current member rows, then checks the caller's role against those locked rows: two admins
 * acting at the same moment queue behind each other, so an admin who was just dismissed (or removed)
 * cannot act, and the member limit cannot be overshot by two simultaneous adds. The notice that goes
 * with each change ("Maya added Noah") is written in the same transaction, so the change and its
 * notice exist together or not at all. A refused change returns { refused: <reason> } and writes nothing.
 */

// the conversation row, then its current members (oldest first), locked until the transaction ends
const lockMembers = async (connection, conversationId) => {
    await connection.execute('select conversation_id from conversations_lst_t where conversation_id = ? and is_active = 1 for update', [conversationId]);
    const [rows] = await connection.execute(
        `select conversation_member_id, user_id, member_role, joined_at from conversation_members_t
            where conversation_id = ? and is_active = 1 and left_at is null
            order by joined_at, conversation_member_id for update`,
        [conversationId]);
    return rows;
};

// the members check every admin action starts with
const adminCheck = (members, actorId) => {
    const actor = members.find((m) => m.user_id === actorId);
    if (!actor) return 'notMember';
    if (actor.member_role !== 'ADMIN') return 'notAdmin';
    return null;
};

const ids = (members) => members.map((m) => m.user_id);

// group notices are written by the server, so they are plain text (enc_format 0), never encrypted
const notice = (connection, { conversationId, actorId, systemTypeId, event, targetId = null, content = null, recipientIds }) =>
    insertWithReceipts(connection, {
        conversationId, senderId: actorId, messageTypeId: systemTypeId, systemEvent: event, systemTargetUserId: targetId,
        content, encFormat: 0, recipientIds: recipientIds.filter((id) => id !== actorId), seen: true
    });

// the members changed: the chat key must change too, so someone who left cannot read what comes next
// and someone who joined gets a copy of the new one. the next sender's app makes it (a chat with no key
// yet needs nothing: its first key is made for whoever is in it then)
const flagNewKey = (connection, conversationId) => connection.execute(
    'update conversations_lst_t set needs_new_key = 1 where conversation_id = ? and current_key_version > 0', [conversationId]);

// what leaving means for the data: the member row is closed (kept, for their history and a later
// re-add), the messages they had not seen stop holding back their senders' ticks, and their pending
// scheduled messages there are cancelled. returns the messages whose ticks may have moved
const endMembership = async (connection, conversationId, userId, reason) => {
    await connection.execute(
        `update conversation_members_t set left_at = now(), member_role = 'MEMBER'
            where conversation_id = ? and user_id = ? and left_at is null`,
        [conversationId, userId]);
    const [unseen] = await connection.execute(
        `select r.message_id from message_receipts_t r join messages_lst_t m on m.message_id = r.message_id
            where r.user_id = ? and m.conversation_id = ? and r.seen_at is null and r.excluded_at is null and r.is_active = 1 for update`,
        [userId, conversationId]);
    const messageIds = unseen.map((u) => u.message_id);
    if (messageIds.length) {
        await connection.execute(
            `update message_receipts_t set excluded_at = now(3) where user_id = ? and message_id in (${messageIds.map(() => '?').join(', ')})`,
            [userId, ...messageIds]);
    }
    const [cancelled] = await connection.execute(
        `update scheduled_messages_t set status = 'CANCELLED', failure_reason = ?
            where conversation_id = ? and sender_id = ? and status = 'PENDING' and is_active = 1`,
        [reason, conversationId, userId]);
    return { messageIds, cancelled: cancelled.affectedRows };
};

// the group, its members (the creator is the first admin) and the "created the group" notice
exports.createGroup = ({ typeId, systemTypeId, creatorId, title, description, memberIds }) => {
    log('in createGroup');
    return dbutils.executeTransaction(async (connection) => {
        const [result] = await connection.execute(
            'insert into conversations_lst_t (conversation_type_id, title, description, created_by) values (?, ?, ?, ?)',
            [typeId, title, description, creatorId]);
        const conversationId = result.insertId;
        const rows = [[creatorId, 'ADMIN'], ...memberIds.map((id) => [id, 'MEMBER'])];
        await connection.execute(
            `insert into conversation_members_t (conversation_id, user_id, member_role) values ${rows.map(() => '(?, ?, ?)').join(', ')}`,
            rows.flatMap(([userId, role]) => [conversationId, userId, role]));
        const noticeId = await notice(connection, { conversationId, actorId: creatorId, systemTypeId, event: 'GROUP_CREATED', content: title, recipientIds: memberIds });
        return { conversationId, noticeIds: [noticeId] };
    }, 'create group');
};

// admins only. people already in the group are skipped; someone who was in it before gets their old
// row back (one row per person per group) and, like anyone new, only receives messages from now on
exports.addMembers = ({ conversationId, actorId, userIds, maxMembers, systemTypeId }) => {
    log('in addMembers');
    return dbutils.executeTransaction(async (connection) => {
        const members = await lockMembers(connection, conversationId);
        const refused = adminCheck(members, actorId);
        if (refused) return { refused };
        const current = new Set(ids(members));
        const toAdd = userIds.filter((id) => !current.has(id));
        const already = userIds.filter((id) => current.has(id));
        if (!toAdd.length) return { added: [], already, noticeIds: [], memberIds: ids(members) };
        if (members.length + toAdd.length > maxMembers) return { refused: 'groupFull', room: Math.max(0, maxMembers - members.length) };

        const [previous] = await connection.execute(
            `select user_id from conversation_members_t where conversation_id = ? and user_id in (${toAdd.map(() => '?').join(', ')}) for update`,
            [conversationId, ...toAdd]);
        const returning = new Set(previous.map((r) => r.user_id));
        for (const userId of toAdd) {
            if (returning.has(userId)) {
                await connection.execute(
                    `update conversation_members_t set member_role = 'MEMBER', left_at = null, is_active = 1, joined_at = now(),
                        is_pinned = 0, pinned_at = null, is_archived = 0, archived_at = null
                        where conversation_id = ? and user_id = ?`,
                    [conversationId, userId]);
            } else {
                await connection.execute("insert into conversation_members_t (conversation_id, user_id, member_role) values (?, ?, 'MEMBER')", [conversationId, userId]);
            }
        }
        const everyone = [...ids(members), ...toAdd];
        await flagNewKey(connection, conversationId);
        const noticeIds = [];
        for (const userId of toAdd) {
            noticeIds.push(await notice(connection, { conversationId, actorId, systemTypeId, event: 'MEMBER_ADDED', targetId: userId, recipientIds: everyone }));
        }
        return { added: toAdd, already, noticeIds, memberIds: everyone };
    }, 'add group members');
};

// admins only, never themselves (that is exiting). the removed member receives the notice: it is the
// last thing they see in the group
exports.removeMember = ({ conversationId, actorId, targetId, systemTypeId }) => {
    log('in removeMember');
    return dbutils.executeTransaction(async (connection) => {
        const members = await lockMembers(connection, conversationId);
        const refused = adminCheck(members, actorId);
        if (refused) return { refused };
        if (!members.some((m) => m.user_id === targetId)) return { refused: 'targetNotMember' };
        const noticeId = await notice(connection, { conversationId, actorId, systemTypeId, event: 'MEMBER_REMOVED', targetId, recipientIds: ids(members) });
        const ended = await endMembership(connection, conversationId, targetId, 'You were removed from the group.');
        await flagNewKey(connection, conversationId);
        return { noticeIds: [noticeId], memberIds: ids(members).filter((id) => id !== targetId), excludedMessageIds: ended.messageIds, cancelledScheduled: ended.cancelled };
    }, 'remove group member');
};

// any member, admin or not. a group is never left without an admin while it has members: when the
// last admin exits, the member who has been in the group longest becomes admin
exports.leave = ({ conversationId, userId, systemTypeId }) => {
    log('in leave group');
    return dbutils.executeTransaction(async (connection) => {
        const members = await lockMembers(connection, conversationId);
        const me = members.find((m) => m.user_id === userId);
        if (!me) return { refused: 'notMember' };
        const remaining = members.filter((m) => m.user_id !== userId);
        const noticeIds = [await notice(connection, { conversationId, actorId: userId, systemTypeId, event: 'MEMBER_LEFT', recipientIds: ids(remaining) })];
        const ended = await endMembership(connection, conversationId, userId, 'You exited the group.');
        await flagNewKey(connection, conversationId);

        let promotedId = null;
        if (me.member_role === 'ADMIN' && remaining.length && !remaining.some((m) => m.member_role === 'ADMIN')) {
            promotedId = remaining[0].user_id;
            await connection.execute("update conversation_members_t set member_role = 'ADMIN' where conversation_id = ? and user_id = ?", [conversationId, promotedId]);
            noticeIds.push(await notice(connection, { conversationId, actorId: promotedId, systemTypeId, event: 'ADMIN_ASSIGNED', targetId: promotedId, recipientIds: ids(remaining) }));
        }
        return { noticeIds, promotedId, memberIds: ids(remaining), excludedMessageIds: ended.messageIds, cancelledScheduled: ended.cancelled };
    }, 'leave group');
};

// admins only: make a member an admin, or dismiss an admin (themselves included, unless they are the
// last one: the group always keeps an admin)
exports.setRole = ({ conversationId, actorId, targetId, role, systemTypeId }) => {
    log('in setRole');
    return dbutils.executeTransaction(async (connection) => {
        const members = await lockMembers(connection, conversationId);
        const refused = adminCheck(members, actorId);
        if (refused) return { refused };
        const target = members.find((m) => m.user_id === targetId);
        if (!target) return { refused: 'targetNotMember' };
        if (target.member_role === role) return { changed: false, noticeIds: [], memberIds: ids(members) };
        if (role === 'MEMBER' && members.filter((m) => m.member_role === 'ADMIN').length <= 1) return { refused: 'lastAdmin' };
        await connection.execute('update conversation_members_t set member_role = ? where conversation_id = ? and user_id = ?', [role, conversationId, targetId]);
        const noticeId = await notice(connection, { conversationId, actorId, systemTypeId, event: role === 'ADMIN' ? 'ADMIN_MADE' : 'ADMIN_DISMISSED', targetId, recipientIds: ids(members) });
        return { changed: true, noticeIds: [noticeId], memberIds: ids(members) };
    }, 'set group role');
};

// admins only: the shared name and / or the description. title / description undefined = unchanged
exports.updateInfo = ({ conversationId, actorId, title, description, systemTypeId }) => {
    log('in updateInfo');
    return dbutils.executeTransaction(async (connection) => {
        const members = await lockMembers(connection, conversationId);
        const refused = adminCheck(members, actorId);
        if (refused) return { refused };
        const [[group]] = await connection.execute('select title, description from conversations_lst_t where conversation_id = ?', [conversationId]);
        const nameChanged = title !== undefined && title !== group.title;
        const descriptionChanged = description !== undefined && (description || null) !== (group.description || null);
        if (!nameChanged && !descriptionChanged) return { changed: false, noticeIds: [], memberIds: ids(members) };

        await connection.execute('update conversations_lst_t set title = ?, description = ? where conversation_id = ?',
            [nameChanged ? title : group.title, descriptionChanged ? description || null : group.description, conversationId]);
        const noticeIds = [];
        if (nameChanged) noticeIds.push(await notice(connection, { conversationId, actorId, systemTypeId, event: 'NAME_CHANGED', content: title, recipientIds: ids(members) }));
        if (descriptionChanged) noticeIds.push(await notice(connection, { conversationId, actorId, systemTypeId, event: 'DESCRIPTION_CHANGED', recipientIds: ids(members) }));
        return { changed: true, noticeIds, memberIds: ids(members) };
    }, 'update group info');
};

// a group the member already exited leaves their list. the row stays (is_active 0) so a later re-add
// reopens it
exports.hideExitedGroup = (conversationId, userId) => {
    log('in hideExitedGroup');
    const qry = `update conversation_members_t set is_active = 0, is_pinned = 0, pinned_at = null
        where conversation_id = ? and user_id = ? and left_at is not null and is_active = 1`;
    return dbutils.executeQuery(qry, [conversationId, userId], 'hide exited group');
};

// the group's own details: name, description, who created it and when
exports.getGroup = (conversationId) => {
    log('in getGroup');
    const qry = `select c.conversation_id, c.title, c.description, c.created_by, c.created_at, cu.first_nm as creator_first_nm, cu.last_nm as creator_last_nm
        from conversations_lst_t c join users_lst_t cu on cu.user_id = c.created_by
        where c.conversation_id = ? and c.is_active = 1`;
    return dbutils.executeQuery(qry, [conversationId], 'get group');
};

// the current members: admins first, then by name
exports.listMembers = (conversationId) => {
    log('in listMembers');
    const qry = `select m.user_id, m.member_role, m.joined_at, u.first_nm, u.last_nm, u.email, u.profile_photo_url
        from conversation_members_t m join users_lst_t u on u.user_id = m.user_id
        where m.conversation_id = ? and m.is_active = 1 and m.left_at is null
        order by m.member_role = 'ADMIN' desc, u.first_nm, u.last_nm, u.user_id`;
    return dbutils.executeQuery(qry, [conversationId], 'list group members');
};
