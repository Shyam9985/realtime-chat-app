const usersMdl = require('../models/usersMdl');
const blocksMdl = require('../models/blocksMdl');
const resutils = require('../utils/response.utils');
const { parseId, toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

const toPublicUser = (row) => ({
    user_id: row.user_id,
    first_nm: row.first_nm,
    last_nm: row.last_nm,
    email: row.email,
    profile_photo_url: row.profile_photo_url
});

// FR-004: discovery. the viewer never sees themselves or anyone who has blocked them
exports.searchSrvc = async (viewerId, query, limit) => {
    log('in searchSrvc');
    const text = typeof query === 'string' ? query.trim() : '';
    if (!text) return [];
    if (text.length > 100) resutils.createError('validationFailed', 'Search text is too long.');

    let size = Number.parseInt(limit, 10);
    if (!Number.isInteger(size) || size < 1) size = 20;
    if (size > 50) size = 50;

    const rows = await usersMdl.searchUsers(viewerId, text, size);
    return rows.map((row) => ({ ...toPublicUser(row), blocked_by_me: !!row.blocked_by_me }));
};

// the user must exist and be active, else the caller gets userNotFound (no detail about why)
const assertActiveUser = async (userId) => {
    const rows = await usersMdl.getActiveUserById(userId);
    if (!rows.length) resutils.createError('userNotFound', 'User not found.');
    return rows[0];
};

// FR-015: block another user, never yourself. idempotent: blocking twice is one block
exports.blockSrvc = async (blockerId, blockedIdRaw) => {
    log('in blockSrvc');
    const blockedId = parseId(blockedIdRaw, 'User id');
    if (blockedId === Number(blockerId)) resutils.createError('selfAction', 'You cannot block yourself.');
    await assertActiveUser(blockedId);

    const [existing] = await blocksMdl.findBlock(blockerId, blockedId);
    if (existing?.is_active) return { user_id: blockedId, blocked: true, changed: false };
    if (existing) {
        await blocksMdl.setBlockActive(existing.block_id, true);
        return { user_id: blockedId, blocked: true, changed: true };
    }
    try {
        await blocksMdl.insertBlock(blockerId, blockedId);
    } catch (error) {
        // two parallel block calls: the unique pair key lets the second one simply re-activate
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const [row] = await blocksMdl.findBlock(blockerId, blockedId);
        if (row && !row.is_active) await blocksMdl.setBlockActive(row.block_id, true);
    }
    return { user_id: blockedId, blocked: true, changed: true };
};

// FR-018: unblock. idempotent: unblocking someone who is not blocked is a no-op success
exports.unblockSrvc = async (blockerId, blockedIdRaw) => {
    log('in unblockSrvc');
    const blockedId = parseId(blockedIdRaw, 'User id');
    if (blockedId === Number(blockerId)) resutils.createError('selfAction', 'You cannot unblock yourself.');

    const [existing] = await blocksMdl.findBlock(blockerId, blockedId);
    if (!existing?.is_active) return { user_id: blockedId, blocked: false, changed: false };
    await blocksMdl.setBlockActive(existing.block_id, false);
    return { user_id: blockedId, blocked: false, changed: true };
};

exports.listBlockedSrvc = async (blockerId) => {
    log('in listBlockedSrvc');
    const rows = await blocksMdl.listBlockedUsers(blockerId);
    return rows.map((row) => ({ ...toPublicUser(row), blocked_at: row.blocked_at }));
};

exports.toPublicUser = toPublicUser;
exports.assertActiveUser = assertActiveUser;

/*
 * Another member's profile. Someone who has blocked the viewer stays visible by name (an existing chat
 * keeps showing them, FR-017) but their photo is withheld, and nothing in the answer says who blocked
 * whom. The mobile number is private and is not part of it.
 */
exports.getProfileSrvc = async (viewerId, userIdRaw) => {
    log('in getProfileSrvc');
    const userId = parseId(userIdRaw, 'User id');
    const me = Number(viewerId);
    const pairKey = `${Math.min(me, userId)}:${Math.max(me, userId)}`;
    const [row] = await usersMdl.getPublicProfile(me, userId, pairKey);
    if (!row) resutils.createError('userNotFound', 'User not found.');

    const photoVisible = !!row.profile_photo_url && !row.has_blocked_me;
    return {
        user_id: row.user_id,
        first_nm: row.first_nm,
        last_nm: row.last_nm,
        email: row.email,
        member_since: toIso(row.member_since),
        has_photo: photoVisible,
        profile_photo_url: photoVisible ? row.profile_photo_url : null,
        blocked_by_me: !!row.blocked_by_me,
        conversation_id: row.conversation_id || null,
        is_me: userId === me,
    };
};
