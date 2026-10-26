const conversationsMdl = require('../models/conversationsMdl');
const usersService = require('./usersService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { parseId, toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

const DIRECT = 'ONE_TO_ONE';

// 'lowId:highId' - the same two users always produce the same key, whoever starts the chat
const pairKeyFor = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

const toSummaryDto = (row) => ({
    conversation_id: row.conversation_id,
    conversation_type: row.conversation_type,
    title: row.title,
    other_user: row.other_user_id ? {
        user_id: row.other_user_id,
        first_nm: row.other_first_nm,
        last_nm: row.other_last_nm,
        email: row.other_email,
        profile_photo_url: row.other_profile_photo_url
    } : null,
    last_message: row.last_message_id ? {
        message_id: row.last_message_id,
        sender_id: row.last_sender_id,
        content: row.last_content,
        is_deleted: !!row.last_is_deleted,
        created_at: toIso(row.last_created_at)
    } : null,
    unread_count: Number(row.unread_count) || 0,
    blocked_by_me: !!row.blocked_by_me,
    last_message_at: toIso(row.last_message_at),
    created_at: toIso(row.created_at)
});

// cached after the first lookup: master rows do not change at runtime
let directTypeId = null;
const getDirectTypeId = async () => {
    if (directTypeId) return directTypeId;
    const [row] = await conversationsMdl.getConversationTypeByCode(DIRECT);
    if (!row) resutils.createError('DatabaseError', 'Conversation type master is not seeded.');
    directTypeId = row.conversation_type_id;
    return directTypeId;
};

exports.getSummarySrvc = async (userId, conversationId) => {
    const [row] = await conversationsMdl.getSummaryForUser(userId, conversationId);
    return row ? toSummaryDto(row) : null;
};

// FR-005: one active one-to-one conversation per pair. the unique user_pair_key is the real guard;
// a lost race shows up as ER_DUP_ENTRY and is resolved by re-reading
exports.getOrCreateDirectSrvc = async (userId, otherUserIdRaw) => {
    log('in getOrCreateDirectSrvc');
    const otherUserId = parseId(otherUserIdRaw, 'User id');
    if (otherUserId === Number(userId)) resutils.createError('selfAction', 'You cannot start a conversation with yourself.');
    await usersService.assertActiveUser(otherUserId);

    const pairKey = pairKeyFor(Number(userId), otherUserId);
    const [existing] = await conversationsMdl.findDirectByPairKey(pairKey);
    if (existing) return { conversation: await exports.getSummarySrvc(userId, existing.conversation_id), created: false };

    let conversationId;
    try {
        conversationId = await conversationsMdl.createDirectConversation(await getDirectTypeId(), userId, otherUserId, pairKey);
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const [raced] = await conversationsMdl.findDirectByPairKey(pairKey);
        if (!raced) throw error;
        return { conversation: await exports.getSummarySrvc(userId, raced.conversation_id), created: false };
    }

    appEvents.emit('conversation.created', { conversationId, memberIds: [Number(userId), otherUserId] });
    return { conversation: await exports.getSummarySrvc(userId, conversationId), created: true };
};

exports.listSrvc = async (userId) => {
    log('in listSrvc');
    const rows = await conversationsMdl.listForUser(userId);
    return rows.map(toSummaryDto);
};

// FR-006: membership gate. a missing conversation and a foreign one get the same answer, so the
// response never confirms that a conversation id exists
exports.assertMemberSrvc = async (conversationIdRaw, userId) => {
    const conversationId = parseId(conversationIdRaw, 'Conversation id');
    const [membership] = await conversationsMdl.getMembership(conversationId, userId);
    if (!membership) resutils.createError('notMember', 'You are not a member of this conversation.');
    return membership;
};

exports.toSummaryDto = toSummaryDto;
exports.pairKeyFor = pairKeyFor;
