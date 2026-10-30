const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

/*
 * Deleting an account removes everything the user wrote or owned, in ONE transaction (it all goes or
 * nothing does), in foreign-key order:
 *  1. one-to-one chats, and groups nobody else is left in: deleted whole (messages, receipts, edit
 *     history, scheduled messages, chat keys, members, the group photo row)
 *  2. every other message they sent, and every group notice about them, with its receipts and edits
 *  3. groups that go on: their member row goes; a group they created passes to an admin (or the
 *     longest-standing member, made admin when no admin is left); the chat needs a new key
 *  4. each remaining member's "last message" pointer is set again from what is left
 *  5. their own rows: receipts, chat-key copies, scheduled messages, photos, blocks, phones, keys,
 *     sessions, login history, audit and email logs, and the account itself
 * Returns the stored file paths to remove from disk after the commit, and who to tell.
 */
const marks = (list) => list.map(() => '?').join(', ');

// one statement per table, scoped to these conversations; nothing runs for an empty list
const deleteConversations = async (c, ids) => {
    if (!ids.length) return [];
    const m = marks(ids);
    await c.execute(`delete r from message_receipts_t r join messages_lst_t msg on msg.message_id = r.message_id where msg.conversation_id in (${m})`, ids);
    await c.execute(`delete e from message_edits_t e join messages_lst_t msg on msg.message_id = e.message_id where msg.conversation_id in (${m})`, ids);
    await c.execute(`update conversations_lst_t set last_message_id = null where conversation_id in (${m})`, ids);
    await c.execute(`update conversation_members_t set last_message_id = null, last_read_message_id = null where conversation_id in (${m})`, ids);
    await c.execute(`delete from scheduled_messages_t where conversation_id in (${m})`, ids);
    await c.execute(`delete from conversation_keys_t where conversation_id in (${m})`, ids);
    await c.execute(`delete from messages_lst_t where conversation_id in (${m})`, ids);
    const [photos] = await c.execute(`select file_id, file_path from uploaded_files_lst_t where entity_type = 'GROUP_PHOTO' and entity_id in (${m})`, ids);
    if (photos.length) await c.execute(`delete from uploaded_files_lst_t where file_id in (${marks(photos)})`, photos.map((p) => p.file_id));
    await c.execute(`delete from conversation_members_t where conversation_id in (${m})`, ids);
    await c.execute(`delete from conversations_lst_t where conversation_id in (${m})`, ids);
    return photos.map((p) => p.file_path);
};

// the "last message" pointers of these chats, set again from the messages that are left: per chat, and
// per member (the newest message each one may see: sent by them, or delivered to them)
const resetLastMessages = async (c, ids) => {
    if (!ids.length) return;
    const m = marks(ids);
    await c.execute(
        `with latest as (
            select msg.conversation_id, max(msg.message_id) as message_id from messages_lst_t msg
            where msg.conversation_id in (${m}) and msg.is_active = 1 group by msg.conversation_id)
        update conversations_lst_t cv
            join latest l on l.conversation_id = cv.conversation_id
            join messages_lst_t lm on lm.message_id = l.message_id
        set cv.last_message_id = lm.message_id, cv.last_message_at = lm.created_at
        where cv.conversation_id in (${m})`,
        [...ids, ...ids]);
    await c.execute(
        `with seen_by as (
            select msg.conversation_id, msg.sender_id as user_id, msg.message_id from messages_lst_t msg
            where msg.conversation_id in (${m}) and msg.is_active = 1
            union all
            select msg.conversation_id, r.user_id, msg.message_id from message_receipts_t r
            join messages_lst_t msg on msg.message_id = r.message_id
            where msg.conversation_id in (${m}) and msg.is_active = 1 and r.is_active = 1),
        latest as (select conversation_id, user_id, max(message_id) as message_id from seen_by group by conversation_id, user_id)
        update conversation_members_t cm
            join latest l on l.conversation_id = cm.conversation_id and l.user_id = cm.user_id
        set cm.last_message_id = l.message_id
        where cm.conversation_id in (${m})`,
        [...ids, ...ids, ...ids]);
};

exports.deleteAccount = (userId) => {
    log('in deleteAccount');
    return dbutils.executeTransaction(async (c) => {
        const [[user]] = await c.execute('select user_id, email from users_lst_t where user_id = ? for update', [userId]);
        if (!user) return { refused: 'userNotFound' };

        // every chat they are or were in, with the people still in it
        const [mine] = await c.execute(
            `select cm.conversation_id, ct.type_code, cv.created_by from conversation_members_t cm
                join conversations_lst_t cv on cv.conversation_id = cm.conversation_id
                join conversations_type_master_t ct on ct.conversation_type_id = cv.conversation_type_id
                where cm.user_id = ? for update`,
            [userId]);
        const ids = mine.map((r) => r.conversation_id);
        const [others] = ids.length ? await c.execute(
            `select conversation_id, user_id, member_role from conversation_members_t
                where conversation_id in (${marks(ids)}) and user_id <> ? and is_active = 1 and left_at is null
                order by conversation_id, joined_at, conversation_member_id for update`,
            [...ids, userId]) : [[]];
        const othersOf = (id) => others.filter((o) => o.conversation_id === id);

        // 1. chats that end with this account
        const direct = mine.filter((r) => r.type_code !== 'GROUP');
        const keptGroups = mine.filter((r) => r.type_code === 'GROUP' && othersOf(r.conversation_id).length);
        const emptyGroups = mine.filter((r) => r.type_code === 'GROUP' && !othersOf(r.conversation_id).length);
        const directPartners = direct.flatMap((r) => othersOf(r.conversation_id).map((o) => ({ conversationId: r.conversation_id, userId: o.user_id })));
        const filePaths = await deleteConversations(c, [...direct, ...emptyGroups].map((r) => r.conversation_id));

        // 2. their messages, and the notices about them, everywhere else
        const [authored] = await c.execute(
            'select message_id, conversation_id from messages_lst_t where sender_id = ? or system_target_user_id = ?', [userId, userId]);
        if (authored.length) {
            const mids = authored.map((r) => r.message_id);
            await c.execute(`delete from message_receipts_t where message_id in (${marks(mids)})`, mids);
            await c.execute(`delete from message_edits_t where message_id in (${marks(mids)})`, mids);
            await c.execute(`delete from messages_lst_t where message_id in (${marks(mids)})`, mids);
        }

        // 3. groups that go on without them
        for (const g of keptGroups) {
            const rest = othersOf(g.conversation_id);
            const admin = rest.find((o) => o.member_role === 'ADMIN') || rest[0];
            if (admin.member_role !== 'ADMIN') {
                await c.execute("update conversation_members_t set member_role = 'ADMIN' where conversation_id = ? and user_id = ?", [g.conversation_id, admin.user_id]);
            }
            if (g.created_by === Number(userId)) {
                await c.execute('update conversations_lst_t set created_by = ? where conversation_id = ?', [admin.user_id, g.conversation_id]);
            }
            await c.execute("update uploaded_files_lst_t set uploaded_by = ? where entity_type = 'GROUP_PHOTO' and entity_id = ? and uploaded_by = ?",
                [admin.user_id, g.conversation_id, userId]);
            // someone left: the next message must use a key they never had
            await c.execute('update conversations_lst_t set needs_new_key = 1 where conversation_id = ? and current_key_version > 0', [g.conversation_id]);
        }
        await c.execute('delete from conversation_members_t where user_id = ?', [userId]);

        // 4. previews follow what is left
        const touched = [...new Set([...keptGroups.map((g) => g.conversation_id), ...authored.map((r) => r.conversation_id)])]
            .filter((id) => !direct.some((d) => d.conversation_id === id) && !emptyGroups.some((g) => g.conversation_id === id));
        await resetLastMessages(c, touched);

        // 5. their own rows
        await c.execute('delete from message_receipts_t where user_id = ?', [userId]);
        // copies they locked for others stay usable by those members (the creator is only a record)
        await c.execute('update conversation_keys_t set created_by = user_id where created_by = ? and user_id <> ?', [userId, userId]);
        await c.execute('delete from conversation_keys_t where user_id = ?', [userId]);
        await c.execute('delete from scheduled_messages_t where sender_id = ?', [userId]);
        const [files] = await c.execute('select file_id, file_path from uploaded_files_lst_t where uploaded_by = ?', [userId]);
        if (files.length) await c.execute(`delete from uploaded_files_lst_t where file_id in (${marks(files)})`, files.map((f) => f.file_id));
        await c.execute('delete from user_blocks_t where blocker_id = ? or blocked_id = ?', [userId, userId]);
        await c.execute('delete from user_devices_t where user_id = ?', [userId]);
        await c.execute('delete from user_keys_t where user_id = ?', [userId]);
        await c.execute('delete s from sessions s join user_sessions_t us on us.session_id = s.session_id where us.user_id = ?', [userId]);
        await c.execute('delete from user_sessions_t where user_id = ?', [userId]);
        await c.execute('delete from user_login_history_t where user_id = ?', [userId]);
        await c.execute('delete from audit_logs_t where user_id = ?', [userId]);
        await c.execute('delete from email_audit_logs_t where create_user = ? or recipient_email = ?', [String(userId), user.email]);
        await c.execute('delete from users_lst_t where user_id = ?', [userId]);

        return {
            filePaths: [...filePaths, ...files.map((f) => f.file_path)],
            directPartners,
            groups: keptGroups.map((g) => ({ conversationId: g.conversation_id, memberIds: othersOf(g.conversation_id).map((o) => o.user_id) })),
        };
    }, 'delete account');
};
