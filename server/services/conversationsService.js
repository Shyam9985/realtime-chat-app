const conversationsMdl = require('../models/conversationsMdl');
const usersService = require('./usersService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

const DIRECT = 'ONE_TO_ONE';
const GROUP = 'GROUP';

// 'lowId:highId' - the same two users always produce the same key, whoever starts the chat
const pairKeyFor = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

const nameOf = (first, last) => (first ? [first, last].filter(Boolean).join(' ') : null);

const toSummaryDto = (row) => ({
    conversation_id: row.conversation_id,
    conversation_type: row.conversation_type,
    // the name this member sees: their own title (one-to-one: the other person's name unless renamed),
    // else the shared group title
    title: row.custom_title || row.title || null,
    description: row.description ?? null,
    // groups: the stored path of the group photo (it changes with every new photo, so it doubles as a cache key)
    photo_url: row.photo_url ?? null,
    created_by: row.created_by,
    // groups: whether the caller is still in it (an exited group stays listed, read-only), their role,
    // and how many people are in it now
    is_member: !row.left_at,
    left_at: toIso(row.left_at),
    my_role: row.my_role,
    member_count: row.conversation_type === GROUP ? Number(row.member_count) || 0 : null,
    is_pinned: !!row.is_pinned,
    pinned_at: toIso(row.pinned_at),
    is_archived: !!row.is_archived,
    archived_at: toIso(row.archived_at),
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
        sender_name: nameOf(row.last_sender_first_nm, row.last_sender_last_nm),
        message_type: row.last_message_type,
        system_event: row.last_system_event ?? null,
        system_target_user_id: row.last_system_target_user_id ?? null,
        system_target_name: nameOf(row.last_target_first_nm, row.last_target_last_nm),
        content: row.last_content,
        key_version: row.last_key_version ?? null,
        enc_format: row.last_enc_format ?? 0,
        is_deleted: !!row.last_is_deleted,
        status: row.last_status,
        created_at: toIso(row.last_created_at)
    } : null,
    unread_count: Number(row.unread_count) || 0,
    // end-to-end encryption: the chat key messages must be sent with, and whether a new one is due
    current_key_version: Number(row.current_key_version) || 0,
    needs_new_key: !!row.needs_new_key,
    blocked_by_me: !!row.blocked_by_me,
    last_message_at: toIso(row.last_created_at),
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
exports.getOrCreateDirectSrvc = async (userId, otherUserId) => {
    log('in getOrCreateDirectSrvc');
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
// response never confirms that a conversation id exists. this is the gate for anything that writes
// to a conversation (send, schedule, forward into, edit, delete, manage a group)
exports.assertMemberSrvc = async (conversationId, userId) => {
    const [membership] = await conversationsMdl.getMembership(conversationId, userId);
    if (!membership) resutils.createError('notMember', 'You are not a member of this conversation.');
    return membership;
};

// the reading gate: current members, and people who exited a group (they keep what they received
// while they were in it: history, search, export, read receipts, pin / archive)
exports.assertReaderSrvc = async (conversationId, userId) => {
    const [membership] = await conversationsMdl.getReadableMembership(conversationId, userId);
    if (!membership) resutils.createError('notMember', 'You are not a member of this conversation.');
    return membership;
};

// GET /conversations/:id: one chat as the caller's list shows it
exports.getOneSrvc = async (userId, conversationId) => {
    log('in getOneSrvc');
    await exports.assertReaderSrvc(conversationId, userId);
    return { conversation: await exports.getSummarySrvc(userId, conversationId) };
};

/*
 * This member's own settings for a chat: { is_pinned?, is_archived?, custom_title? }. Nothing here
 * changes what the other member sees. Archiving unpins; a blank title goes back to the default (the
 * other person's name in a one-to-one chat). The member's other devices are told live. The values come
 * checked from conversationsVldtr.validateSettings (custom_title trimmed, '' = back to the default).
 */
exports.updateSettingsSrvc = async (userId, conversationId, { isPinned, isArchived, customTitle: title }) => {
    log('in updateSettingsSrvc');
    const membership = await exports.assertReaderSrvc(conversationId, userId);

    let customTitle;
    if (title !== undefined) {
        // a group has one name for everyone, changed by its admins (PATCH /conversations/:id/group)
        if (membership.type_code === GROUP) resutils.createError('validationFailed', "A group's name is the same for everyone. Admins change it from Group info.");
        if (title) customTitle = title;
        else if (membership.type_code === DIRECT) customTitle = (await conversationsMdl.getDefaultDirectTitle(conversationId, userId))[0]?.title || null;
        else customTitle = null;
    }

    await conversationsMdl.updateMemberSettings(conversationId, userId, { isPinned, isArchived, customTitle });
    const conversation = await exports.getSummarySrvc(userId, conversationId);
    appEvents.emit('conversation.updated', { userId: Number(userId), conversation });
    return { conversation };
};

exports.toSummaryDto = toSummaryDto;
exports.pairKeyFor = pairKeyFor;
exports.nameOf = nameOf;
exports.DIRECT = DIRECT;
exports.GROUP = GROUP;
