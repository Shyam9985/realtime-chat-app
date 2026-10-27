const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// the block row for a pair, active or not (the pair is unique, so at most one row)
exports.findBlock = (blockerId, blockedId) => {
    log('in findBlock');
    const qry = 'select block_id, blocker_id, blocked_id, is_active from user_blocks_t where blocker_id = ? and blocked_id = ?';
    return dbutils.executeQuery(qry, [blockerId, blockedId], 'find block');
};

exports.insertBlock = (blockerId, blockedId) => {
    log('in insertBlock');
    const qry = 'insert into user_blocks_t (blocker_id, blocked_id, is_active) values (?, ?, 1)';
    return dbutils.executeQuery(qry, [blockerId, blockedId], 'insert block');
};

// unblock -> is_active 0, block again -> is_active 1. the row is never deleted so the history stays
exports.setBlockActive = (blockId, active) => {
    log('in setBlockActive');
    const qry = 'update user_blocks_t set is_active = ? where block_id = ?';
    return dbutils.executeQuery(qry, [active ? 1 : 0, blockId], 'set block active');
};

// FR-016: directional. true when the recipient has an active block on the sender
exports.isSenderBlockedByRecipient = async (senderId, recipientId) => {
    log('in isSenderBlockedByRecipient');
    const qry = 'select 1 as blocked from user_blocks_t where blocker_id = ? and blocked_id = ? and is_active = 1 limit 1';
    const rows = await dbutils.executeQuery(qry, [recipientId, senderId], 'is sender blocked');
    return rows.length > 0;
};

// every recipient in the list that has an active block on the sender
exports.recipientsBlockingSender = (senderId, recipientIds) => {
    log('in recipientsBlockingSender');
    if (!recipientIds.length) return Promise.resolve([]);
    const marks = recipientIds.map(() => '?').join(', ');
    const qry = `select blocker_id from user_blocks_t where blocked_id = ? and is_active = 1 and blocker_id in (${marks})`;
    return dbutils.executeQuery(qry, [senderId, ...recipientIds], 'recipients blocking sender');
};

// the people in the list with an active block between them and userId, in either direction (adding
// to a group: nobody is put in a group with someone they blocked or who blocked them, by that person)
exports.blockedEitherWay = (userId, otherIds) => {
    log('in blockedEitherWay');
    if (!otherIds.length) return Promise.resolve([]);
    const marks = otherIds.map(() => '?').join(', ');
    const qry = `select blocked_id as user_id from user_blocks_t where blocker_id = ? and is_active = 1 and blocked_id in (${marks})
        union select blocker_id as user_id from user_blocks_t where blocked_id = ? and is_active = 1 and blocker_id in (${marks})`;
    return dbutils.executeQuery(qry, [userId, ...otherIds, userId, ...otherIds], 'blocked either way');
};

exports.listBlockedUsers = (blockerId) => {
    log('in listBlockedUsers');
    const qry = `select b.block_id, u.user_id, u.first_nm, u.last_nm, u.email, u.profile_photo_url, b.updated_at as blocked_at
        from user_blocks_t b
        join users_lst_t u on u.user_id = b.blocked_id
        where b.blocker_id = ? and b.is_active = 1
        order by b.updated_at desc`;
    return dbutils.executeQuery(qry, [blockerId], 'list blocked users');
};
