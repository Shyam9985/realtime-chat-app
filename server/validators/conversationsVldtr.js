const resutils = require('../utils/response.utils');
const validutils = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

// request rules for a member's own conversation settings and for starting a one-to-one chat
const MAX_TITLE = 100;

const optionalBoolean = (value, label) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') resutils.createError('validationFailed', `${label} must be true or false.`);
    return value;
};

exports.conversationId = (value) => validutils.parseId(value, 'Conversation id');

// POST /conversations  { user_id }
exports.validateGetOrCreate = async (body = {}) => {
    log('in validateGetOrCreate');
    const validation = await validutils.validatePayload(body, {
        user_id: { required: true, type: 'number', label: 'User id' }
    });
    if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);
    return { otherUserId: validutils.parseId(body.user_id, 'User id') };
};

// PATCH /conversations/:id/settings  { is_pinned?, is_archived?, custom_title? }. custom_title comes back
// trimmed; '' (blank or null) means "back to the default name", undefined means "not changed"
exports.validateSettings = (params = {}, body = {}) => {
    log('in validateSettings');
    const conversationId = validutils.parseId(params.id, 'Conversation id');
    const isPinned = optionalBoolean(body.is_pinned, 'is_pinned');
    const isArchived = optionalBoolean(body.is_archived, 'is_archived');
    let customTitle;
    if (body.custom_title !== undefined) {
        if (body.custom_title !== null && typeof body.custom_title !== 'string') resutils.createError('validationFailed', 'The name must be text.');
        customTitle = (body.custom_title || '').trim();
        if (customTitle.length > MAX_TITLE) resutils.createError('validationFailed', `The name cannot exceed ${MAX_TITLE} characters.`);
    }
    if (isPinned === undefined && isArchived === undefined && customTitle === undefined) resutils.createError('validationFailed', 'Nothing to change.');
    return { conversationId, isPinned, isArchived, customTitle };
};
