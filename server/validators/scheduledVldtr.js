const resutils = require('../utils/response.utils');
const { parseId } = require('../utils/validate.utils');
const { validateContent, validateReplyToId } = require('./messagesVldtr');
const { log } = require('../utils/log.utils');

// request rules for scheduled messages. the time window is relative to now only, so it needs no database
const MIN_LEAD_SECONDS = 60;
const MAX_LEAD_DAYS = 365;

const parseSendAt = (value) => {
    const sendAt = typeof value === 'string' ? new Date(value) : null;
    if (!sendAt || Number.isNaN(sendAt.getTime())) resutils.createError('validationFailed', 'Choose a valid date and time.');
    const lead = sendAt.getTime() - Date.now();
    if (lead < MIN_LEAD_SECONDS * 1000) resutils.createError('validationFailed', 'Choose a time at least a minute from now.');
    if (lead > MAX_LEAD_DAYS * 86400000) resutils.createError('validationFailed', 'Choose a time within the next year.');
    return sendAt;
};

exports.conversationId = (value) => parseId(value, 'Conversation id');
exports.scheduledId = (value) => parseId(value, 'Scheduled message id');

// POST /conversations/:id/scheduled  { content, send_at, reply_to_message_id? }
exports.validateCreate = (params = {}, body = {}) => {
    log('in scheduled validateCreate');
    return {
        conversationId: parseId(params.id, 'Conversation id'),
        content: validateContent(body.content),
        sendAt: parseSendAt(body.send_at),
        replyToMessageId: validateReplyToId(body.reply_to_message_id)
    };
};

// PATCH /scheduled/:id  { content?, send_at? }  - at least one of them
exports.validateUpdate = (params = {}, body = {}) => {
    log('in scheduled validateUpdate');
    const scheduledId = parseId(params.id, 'Scheduled message id');
    const content = body.content !== undefined ? validateContent(body.content) : undefined;
    const sendAt = body.send_at !== undefined ? parseSendAt(body.send_at) : undefined;
    if (content === undefined && sendAt === undefined) resutils.createError('validationFailed', 'Nothing to change.');
    return { scheduledId, content, sendAt };
};
