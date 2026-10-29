const resutils = require('../utils/response.utils');
const { parseId } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * Request rules for messages: everything that can be checked from the request alone. The controllers
 * (and the socket handlers, which play the controller role there) run these before the service, so the
 * service gets clean typed values and keeps only the rules that need the database.
 */
// configurable limits; the defaults are the SRS values
const MAX_LENGTH = Number(process.env.MESSAGE_MAX_LENGTH) || 2000;
const MAX_FORWARD_TARGETS = 10;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_TEXT = 100;
const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

// FR-007 / FR-027: text only, trimmed, non-empty, bounded
const validateContent = (content) => {
    if (typeof content !== 'string') resutils.createError('validationFailed', 'Message content must be text.');
    const text = content.trim();
    if (!text) resutils.createError('validationFailed', 'Message cannot be empty.');
    if (text.length > MAX_LENGTH) resutils.createError('validationFailed', `Message cannot exceed ${MAX_LENGTH} characters.`);
    return text;
};

const validateClientMessageId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 36 || !/^[A-Za-z0-9_-]+$/.test(value)) {
        resutils.createError('validationFailed', 'client_message_id must be up to 36 url-safe characters.');
    }
    return value;
};

// the quoted message's id, or null when the message is not a reply. whether it may be quoted is the service's call
const validateReplyToId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    return parseId(value, 'Reply message id');
};

// cursor = base64url('<created_at iso>|<message_id>') of the oldest message the client has
// (messagesService.encodeCursor builds it)
const decodeCursor = (value) => {
    if (!value) return null;
    try {
        const [iso, id] = Buffer.from(String(value), 'base64url').toString('utf8').split('|');
        const createdAt = new Date(iso);
        const messageId = Number(id);
        if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(messageId) || messageId < 1) throw new Error('bad cursor');
        return { createdAt, messageId };
    } catch (_) {
        return resutils.createError('invalidCursor', 'Invalid cursor.');
    }
};

exports.messageId = (value) => parseId(value, 'Message id');
exports.conversationId = (value) => parseId(value, 'Conversation id');

// POST /messages and message:send  { conversation_id, content, client_message_id?, reply_to_message_id? }
exports.validateSend = (body = {}) => {
    log('in validateSend');
    return {
        conversationId: parseId(body.conversation_id, 'Conversation id'),
        content: validateContent(body.content),
        clientMessageId: validateClientMessageId(body.client_message_id),
        replyToMessageId: validateReplyToId(body.reply_to_message_id)
    };
};

// GET /conversations/:id/messages?cursor=&limit=&days=
exports.validateHistory = (params = {}, query = {}) => {
    log('in validateHistory');
    const conversationId = parseId(params.id, 'Conversation id');
    let limit = Number.parseInt(query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_PAGE;
    if (limit > MAX_PAGE) limit = MAX_PAGE;
    const cursor = decodeCursor(query.cursor);

    // days only shapes the opening page; with a cursor it is ignored
    let days = null;
    if (!cursor && query.days !== undefined) {
        days = Number.parseInt(query.days, 10);
        if (!Number.isInteger(days) || days < 1 || days > 90) resutils.createError('validationFailed', 'days must be a whole number from 1 to 90.');
    }
    return { conversationId, cursor, limit, days };
};

// PATCH /messages/:id  { content }
exports.validateEdit = (params = {}, body = {}) => {
    log('in validateEdit');
    return { messageId: parseId(params.id, 'Message id'), content: validateContent(body.content) };
};

// POST /messages/:id/forward  { conversation_ids: [] }  - unique targets, at most MAX_FORWARD_TARGETS
exports.validateForward = (params = {}, body = {}) => {
    log('in validateForward');
    const messageId = parseId(params.id, 'Message id');
    const raw = body.conversation_ids;
    if (!Array.isArray(raw) || !raw.length) resutils.createError('validationFailed', 'Choose at least one conversation.');
    const conversationIds = [...new Set(raw.map((id) => parseId(id, 'Conversation id')))];
    if (conversationIds.length > MAX_FORWARD_TARGETS) resutils.createError('validationFailed', `You can forward to at most ${MAX_FORWARD_TARGETS} conversations at once.`);
    return { messageId, conversationIds };
};

// GET /conversations/:id/messages/search?q=&limit=
exports.validateSearch = (params = {}, query = {}) => {
    log('in validateSearch');
    const conversationId = parseId(params.id, 'Conversation id');
    const text = typeof query.q === 'string' ? query.q.trim() : '';
    if (!text) resutils.createError('validationFailed', 'Type something to search for.');
    if (text.length > MAX_SEARCH_TEXT) resutils.createError('validationFailed', `Search text cannot exceed ${MAX_SEARCH_TEXT} characters.`);
    let limit = Number.parseInt(query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_RESULTS) limit = 50;
    return { conversationId, text, limit };
};

exports.validateContent = validateContent;
exports.validateClientMessageId = validateClientMessageId;
exports.validateReplyToId = validateReplyToId;
exports.MAX_LENGTH = MAX_LENGTH;
