const resutils = require('../utils/response.utils');
const { parseId } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * Request rules for groups: names, descriptions, member id lists and roles. Whether the caller may make
 * the change (member, admin, room left in the group) is decided by groupsService against the database.
 */
const MAX_MEMBERS = Number(process.env.GROUP_MAX_MEMBERS) || 100;
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;
const ROLES = ['ADMIN', 'MEMBER'];

const validateTitle = (value) => {
    if (typeof value !== 'string') resutils.createError('validationFailed', 'Give the group a name.');
    const title = value.trim();
    if (!title) resutils.createError('validationFailed', 'Give the group a name.');
    if (title.length > MAX_TITLE) resutils.createError('validationFailed', `The group name cannot exceed ${MAX_TITLE} characters.`);
    return title;
};

// undefined = not given; null or blank = no description
const validateDescription = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') resutils.createError('validationFailed', 'The description must be text.');
    const text = value.trim();
    if (text.length > MAX_DESCRIPTION) resutils.createError('validationFailed', `The description cannot exceed ${MAX_DESCRIPTION} characters.`);
    return text || null;
};

// a list of other people's ids: unique, the caller left out, at most `max`
const validateUserIds = (value, selfId, max) => {
    if (!Array.isArray(value) || !value.length) resutils.createError('validationFailed', 'Choose at least one person.');
    const userIds = [...new Set(value.map((id) => parseId(id, 'User id')))].filter((id) => id !== selfId);
    if (!userIds.length) resutils.createError('validationFailed', 'Choose at least one person other than yourself.');
    if (userIds.length > max) resutils.createError('groupFull', `A group can have at most ${MAX_MEMBERS} members, you included.`);
    return userIds;
};

exports.conversationId = (value) => parseId(value, 'Conversation id');

// POST /conversations/groups  { title, description?, member_ids }  - the creator counts as a member
exports.validateCreate = (body = {}, selfId) => {
    log('in group validateCreate');
    return {
        title: validateTitle(body.title),
        description: validateDescription(body.description) ?? null,
        memberIds: validateUserIds(body.member_ids, Number(selfId), MAX_MEMBERS - 1)
    };
};

// PATCH /conversations/:id/group  { title?, description? }
exports.validateUpdateInfo = (params = {}, body = {}) => {
    log('in group validateUpdateInfo');
    const conversationId = parseId(params.id, 'Conversation id');
    const title = body.title === undefined ? undefined : validateTitle(body.title);
    const description = validateDescription(body.description);
    if (title === undefined && description === undefined) resutils.createError('validationFailed', 'Nothing to change.');
    return { conversationId, title, description };
};

// POST /conversations/:id/members  { user_ids }
exports.validateAddMembers = (params = {}, body = {}, selfId) => {
    log('in group validateAddMembers');
    return {
        conversationId: parseId(params.id, 'Conversation id'),
        userIds: validateUserIds(body.user_ids, Number(selfId), MAX_MEMBERS)
    };
};

// DELETE /conversations/:id/members/:userId
exports.validateMemberTarget = (params = {}) => {
    log('in group validateMemberTarget');
    return { conversationId: parseId(params.id, 'Conversation id'), targetId: parseId(params.userId, 'User id') };
};

// PATCH /conversations/:id/members/:userId  { role: 'ADMIN' | 'MEMBER' }
exports.validateSetRole = (params = {}, body = {}) => {
    log('in group validateSetRole');
    const { conversationId, targetId } = exports.validateMemberTarget(params);
    if (!ROLES.includes(body.role)) resutils.createError('validationFailed', `role must be one of: ${ROLES.join(', ')}.`);
    return { conversationId, targetId, role: body.role };
};

exports.MAX_MEMBERS = MAX_MEMBERS;
