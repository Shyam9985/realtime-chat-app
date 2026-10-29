const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

exports.getConversationTypeByCode = (code) => {
    log('in getConversationTypeByCode');
    const qry = 'select conversation_type_id, type_code from conversations_type_master_t where type_code = ? and is_active = 1';
    return dbutils.executeQuery(qry, [code], 'get conversation type');
};

// the one-to-one conversation of a pair, if it exists (user_pair_key is unique)
exports.findDirectByPairKey = (pairKey) => {
    log('in findDirectByPairKey');
    const qry = 'select conversation_id from conversations_lst_t where user_pair_key = ? and is_active = 1';
    return dbutils.executeQuery(qry, [pairKey], 'find direct conversation');
};

// conversation + both memberships in one transaction: either the whole chat exists or none of it
exports.createDirectConversation = (typeId, createdBy, otherUserId, pairKey) => {
    log('in createDirectConversation');
    return dbutils.executeTransaction(async (connection) => {
        const [result] = await connection.execute(
            'insert into conversations_lst_t (conversation_type_id, created_by, user_pair_key) values (?, ?, ?)',
            [typeId, createdBy, pairKey]);
        const conversationId = result.insertId;
        // each member's title starts as the other person's name (renamable per member later)
        const memberWithTitle = `insert into conversation_members_t (conversation_id, user_id, member_role, custom_title)
            select ?, ?, 'MEMBER', left(trim(concat(first_nm, ' ', ifnull(last_nm, ''))), 100) from users_lst_t where user_id = ?`;
        await connection.execute(memberWithTitle, [conversationId, createdBy, otherUserId]);
        await connection.execute(memberWithTitle, [conversationId, otherUserId, createdBy]);
        return conversationId;
    }, 'create direct conversation');
};

const MEMBERSHIP_SELECT = `select m.conversation_member_id, m.conversation_id, m.user_id, m.member_role, m.last_read_message_id, m.left_at,
            c.conversation_type_id, ct.type_code
        from conversation_members_t m
        join conversations_lst_t c on c.conversation_id = m.conversation_id and c.is_active = 1
        join conversations_type_master_t ct on ct.conversation_type_id = c.conversation_type_id
        where m.conversation_id = ? and m.user_id = ? and m.is_active = 1`;

// the caller's current membership row (still in the conversation), or nothing
exports.getMembership = (conversationId, userId) => {
    log('in getMembership');
    return dbutils.executeQuery(`${MEMBERSHIP_SELECT} and m.left_at is null`, [conversationId, userId], 'get membership');
};

// current OR former membership: someone who exited a group keeps reading what they received there
exports.getReadableMembership = (conversationId, userId) => {
    log('in getReadableMembership');
    return dbutils.executeQuery(MEMBERSHIP_SELECT, [conversationId, userId], 'get readable membership');
};

// active member ids of a conversation
exports.getMemberIds = async (conversationId) => {
    log('in getMemberIds');
    const qry = 'select user_id from conversation_members_t where conversation_id = ? and is_active = 1 and left_at is null';
    const rows = await dbutils.executeQuery(qry, [conversationId], 'get member ids');
    return rows.map((r) => r.user_id);
};

// one conversation as the list shows it (same shape as listForUser, for a single id). the preview is
// the newest message THIS member can see (their own pointer), so a group they exited stops moving and
// a sender they blocked never shows up in it. groups they exited stay listed, read-only (left_at)
const SUMMARY_SELECT = `select c.conversation_id, ct.type_code as conversation_type, c.title, c.description, c.created_by, c.created_at,
            c.current_key_version, c.needs_new_key,
            me.custom_title, me.member_role as my_role, me.left_at, me.is_pinned, me.pinned_at, me.is_archived, me.archived_at,
            lm.message_id as last_message_id, lm.sender_id as last_sender_id, lm.is_deleted as last_is_deleted,
            case when lm.is_deleted = 1 then null else lm.content end as last_content, lm.key_version as last_key_version, lm.enc_format as last_enc_format,
            lm.created_at as last_created_at,
            lmt.type_code as last_message_type, lm.system_event as last_system_event, lm.system_target_user_id as last_system_target_user_id,
            lsu.first_nm as last_sender_first_nm, lsu.last_nm as last_sender_last_nm, ltu.first_nm as last_target_first_nm, ltu.last_nm as last_target_last_nm,
            -- the last message's ticks, aggregated over its recipients exactly like the message history does
            (select case when count(*) > 0 and sum(r2.seen_at is null) = 0 then 'SEEN'
                         when count(*) > 0 and sum(r2.delivered_at is null) = 0 then 'DELIVERED' else 'SENT' end
                from message_receipts_t r2 where r2.message_id = lm.message_id and r2.is_active = 1 and r2.excluded_at is null) as last_status,
            ou.user_id as other_user_id, ou.first_nm as other_first_nm, ou.last_nm as other_last_nm, ou.email as other_email,
            ou.profile_photo_url as other_profile_photo_url,
            (select count(*) from conversation_members_t gm
                where gm.conversation_id = c.conversation_id and gm.is_active = 1 and gm.left_at is null) as member_count,
            (select count(*) from message_receipts_t r join messages_lst_t m2 on m2.message_id = r.message_id
                where r.user_id = me.user_id and r.seen_at is null and r.is_active = 1 and m2.conversation_id = c.conversation_id and m2.is_deleted = 0) as unread_count,
            exists(select 1 from user_blocks_t b where b.blocker_id = me.user_id and b.blocked_id = ou.user_id and b.is_active = 1) as blocked_by_me
        from conversation_members_t me
        join conversations_lst_t c on c.conversation_id = me.conversation_id and c.is_active = 1
        join conversations_type_master_t ct on ct.conversation_type_id = c.conversation_type_id
        left join messages_lst_t lm on lm.message_id = me.last_message_id
        left join message_type_master_t lmt on lmt.message_type_id = lm.message_type_id
        left join users_lst_t lsu on lsu.user_id = lm.sender_id
        left join users_lst_t ltu on ltu.user_id = lm.system_target_user_id
        left join conversation_members_t om on om.conversation_id = c.conversation_id and om.user_id <> me.user_id and om.is_active = 1 and ct.type_code = 'ONE_TO_ONE'
        left join users_lst_t ou on ou.user_id = om.user_id
        where me.user_id = ? and me.is_active = 1`;

exports.listForUser = (userId) => {
    log('in listForUser');
    // pinned chats first, the most recently pinned on top; then everything by latest activity
    const qry = `${SUMMARY_SELECT} order by me.is_pinned desc, me.pinned_at desc, coalesce(lm.created_at, c.created_at) desc, c.conversation_id desc`;
    return dbutils.executeQuery(qry, [userId], 'list conversations');
};

exports.getSummaryForUser = (userId, conversationId) => {
    log('in getSummaryForUser');
    const qry = `${SUMMARY_SELECT} and c.conversation_id = ?`;
    return dbutils.executeQuery(qry, [userId, conversationId], 'get conversation summary');
};

// this member's own settings for a chat. only the fields given are changed; pinning and archiving
// stamp their time, and archiving a chat also unpins it
exports.updateMemberSettings = (conversationId, userId, { isPinned, isArchived, customTitle }) => {
    log('in updateMemberSettings');
    const sets = [];
    const params = [];
    if (isArchived !== undefined) {
        sets.push('is_archived = ?', 'archived_at = case when ? = 1 then now(3) else null end');
        params.push(isArchived ? 1 : 0, isArchived ? 1 : 0);
        if (isArchived) sets.push('is_pinned = 0', 'pinned_at = null');
    }
    if (isPinned !== undefined && !isArchived) {
        sets.push('is_pinned = ?', 'pinned_at = case when ? = 1 then now(3) else null end');
        params.push(isPinned ? 1 : 0, isPinned ? 1 : 0);
    }
    if (customTitle !== undefined) { sets.push('custom_title = ?'); params.push(customTitle); }
    if (!sets.length) return Promise.resolve({ affectedRows: 0 });
    // a group the member exited can still be pinned or archived: it stays in their list, read-only
    const qry = `update conversation_members_t set ${sets.join(', ')} where conversation_id = ? and user_id = ? and is_active = 1`;
    return dbutils.executeQuery(qry, [...params, conversationId, userId], 'update member settings');
};

// a conversation's type and shared name (a group's title; null for one-to-one), for notifications
exports.getTypeAndTitle = (conversationId) => {
    log('in getTypeAndTitle');
    const qry = `select ct.type_code, c.title from conversations_lst_t c
        join conversations_type_master_t ct on ct.conversation_type_id = c.conversation_type_id
        where c.conversation_id = ?`;
    return dbutils.executeQuery(qry, [conversationId], 'conversation type and title');
};

// the default title of a one-to-one chat for this member: the other person's name
exports.getDefaultDirectTitle = (conversationId, userId) => {
    log('in getDefaultDirectTitle');
    const qry = `select left(trim(concat(u.first_nm, ' ', ifnull(u.last_nm, ''))), 100) as title
        from conversation_members_t om join users_lst_t u on u.user_id = om.user_id
        where om.conversation_id = ? and om.user_id <> ? and om.is_active = 1 limit 1`;
    return dbutils.executeQuery(qry, [conversationId, userId], 'default direct title');
};

// conversations where this member has unseen messages (read all), groups they exited included
exports.listWithUnread = (userId) => {
    log('in listWithUnread');
    const qry = `select distinct m.conversation_id from message_receipts_t r
        join messages_lst_t m on m.message_id = r.message_id
        join conversation_members_t me on me.conversation_id = m.conversation_id and me.user_id = r.user_id and me.is_active = 1
        where r.user_id = ? and r.seen_at is null and r.is_active = 1 and m.is_deleted = 0`;
    return dbutils.executeQuery(qry, [userId], 'list conversations with unread');
};

// the one-to-one chats where the other member still shows this user's old name (never renamed it):
// they follow a change of name. returns the other members whose title changed
exports.renameInDirectChats = (userId, oldName, newName) => {
    log('in renameInDirectChats');
    return dbutils.executeTransaction(async (connection) => {
        const [rows] = await connection.execute(
            `select om.conversation_id, om.user_id from conversation_members_t om
                join conversation_members_t me on me.conversation_id = om.conversation_id and me.user_id = ? and me.is_active = 1
                join conversations_lst_t c on c.conversation_id = om.conversation_id and c.user_pair_key is not null and c.is_active = 1
                where om.user_id <> ? and om.is_active = 1 and om.custom_title = ? for update`,
            [userId, userId, oldName]);
        for (const row of rows) {
            await connection.execute('update conversation_members_t set custom_title = ? where conversation_id = ? and user_id = ?', [newName, row.conversation_id, row.user_id]);
        }
        return rows;
    }, 'rename in direct chats');
};
