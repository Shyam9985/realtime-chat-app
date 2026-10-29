const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// the columns another user is allowed to see about a user
const PUBLIC_COLUMNS = 'u.user_id, u.first_nm, u.last_nm, u.email, u.profile_photo_url, u.last_login';

// active user by id, public columns only
exports.getActiveUserById = (userId) => {
    log('in getActiveUserById');
    const qry = `select ${PUBLIC_COLUMNS}, u.is_active from users_lst_t u where u.user_id = ? and u.is_active = 1`;
    return dbutils.executeQuery(qry, [userId], 'get active user by id');
};

// the app closed its last live connection: this moment is the user's "last seen"
exports.markLastSeen = (userId) => {
    log('in markLastSeen');
    return dbutils.executeQuery('update users_lst_t set last_seen_at = now(3) where user_id = ?', [userId], 'mark last seen');
};

exports.getLastSeen = (userId) => {
    log('in getLastSeen');
    return dbutils.executeQuery('select last_seen_at from users_lst_t where user_id = ?', [userId], 'get last seen');
};

// who may see this user's online / last seen: the other member of each of their one-to-one chats,
// unless either of the two has blocked the other
exports.listPresenceWatchers = (userId) => {
    log('in listPresenceWatchers');
    const qry = `select distinct om.user_id from conversation_members_t me
        join conversations_lst_t c on c.conversation_id = me.conversation_id and c.user_pair_key is not null and c.is_active = 1
        join conversation_members_t om on om.conversation_id = me.conversation_id and om.user_id <> me.user_id and om.is_active = 1
        where me.user_id = ? and me.is_active = 1
          and not exists (select 1 from user_blocks_t b where b.is_active = 1
              and ((b.blocker_id = me.user_id and b.blocked_id = om.user_id) or (b.blocker_id = om.user_id and b.blocked_id = me.user_id)))`;
    return dbutils.executeQuery(qry, [userId], 'list presence watchers');
};

// which of these ids are active accounts
exports.getActiveIdsIn = (userIds) => {
    log('in getActiveIdsIn');
    if (!userIds.length) return Promise.resolve([]);
    const qry = `select user_id from users_lst_t where is_active = 1 and user_id in (${userIds.map(() => '?').join(', ')})`;
    return dbutils.executeQuery(qry, userIds, 'get active ids');
};

// discovery: active users other than the viewer, matched on name or email, excluding anyone who
// has blocked the viewer (they must stay invisible). blocked_by_me lets the client label people
// the viewer has blocked without a second call
exports.searchUsers = (viewerId, query, limit) => {
    log('in searchUsers');
    const like = `%${query}%`;
    const qry = `select ${PUBLIC_COLUMNS},
            exists(select 1 from user_blocks_t b where b.blocker_id = ? and b.blocked_id = u.user_id and b.is_active = 1) as blocked_by_me
        from users_lst_t u
        where u.is_active = 1
          and u.user_id <> ?
          and (u.first_nm like ? or u.last_nm like ? or concat(u.first_nm, ' ', ifnull(u.last_nm, '')) like ? or u.email like ?)
          and not exists(select 1 from user_blocks_t bb where bb.blocker_id = u.user_id and bb.blocked_id = ? and bb.is_active = 1)
        order by u.first_nm, u.last_nm, u.user_id
        limit ${Number(limit)}`;
    return dbutils.executeQuery(qry, [viewerId, viewerId, like, like, like, like, viewerId], 'search users');
};

// a member as another signed-in member sees them: public columns, when they joined, and the relationship
// to the viewer (blocks in both directions, their one-to-one conversation if there is one)
exports.getPublicProfile = (viewerId, userId, pairKey) => {
    log('in getPublicProfile');
    const qry = `select u.user_id, u.first_nm, u.last_nm, u.email, u.profile_photo_url, u.created_at as member_since, u.last_seen_at,
            exists(select 1 from user_blocks_t b where b.blocker_id = ? and b.blocked_id = u.user_id and b.is_active = 1) as blocked_by_me,
            exists(select 1 from user_blocks_t b where b.blocker_id = u.user_id and b.blocked_id = ? and b.is_active = 1) as has_blocked_me,
            (select c.conversation_id from conversations_lst_t c where c.user_pair_key = ? and c.is_active = 1) as conversation_id
        from users_lst_t u
        where u.user_id = ? and u.is_active = 1`;
    return dbutils.executeQuery(qry, [viewerId, viewerId, pairKey, userId], 'get public profile');
};
