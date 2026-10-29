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
// content is end-to-end encrypted: the server only sees base64 of (nonce + encrypted text + tag). the
// app enforces MAX_LENGTH on the text itself; this bounds what MAX_LENGTH characters can become
// (up to 4 bytes each in utf-8, plus the 24-byte nonce and 16-byte tag, then base64)
const MAX_CIPHERTEXT = Math.ceil(((MAX_LENGTH * 4) + 40) / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

// FR-007 / FR-027: the encrypted text. the server cannot read it, so it checks only that it is
// well-formed base64 of a sensible size (empty and too-long text are refused by the app before encrypting)
const validateContent = (content) => {
    if (typeof content !== 'string' || !content) resutils.createError('validationFailed', 'Message cannot be empty.');
    if (content.length > MAX_CIPHERTEXT) resutils.createError('validationFailed', `Message cannot exceed ${MAX_LENGTH} characters.`);
    if (!BASE64.test(content)) resutils.createError('validationFailed', 'Message content must be encrypted (base64).');
    return content;
};

// which chat key version encrypted the content (the service checks it is the current one)
const validateKeyVersion = (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) resutils.createError('validationFailed', 'key_version must be a whole number from 1.');
    return n;
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

// POST /messages and message:send  { conversation_id, content, key_version, client_message_id?, reply_to_message_id? }
exports.validateSend = (body = {}) => {
    log('in validateSend');
    return {
        conversationId: parseId(body.conversation_id, 'Conversation id'),
        content: validateContent(body.content),
        keyVersion: validateKeyVersion(body.key_version),
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

// PATCH /messages/:id  { content, key_version }  - the new text, encrypted with the chat's current key
exports.validateEdit = (params = {}, body = {}) => {
    log('in validateEdit');
    return { messageId: parseId(params.id, 'Message id'), content: validateContent(body.content), keyVersion: validateKeyVersion(body.key_version) };
};

// POST /messages/:id/forward  { targets: [{ conversation_id, content, key_version }] }. the server cannot
// copy encrypted text between chats (each chat has its own key), so the app sends the text encrypted
// once per target; unique targets, at most MAX_FORWARD_TARGETS
exports.validateForward = (params = {}, body = {}) => {
    log('in validateForward');
    const messageId = parseId(params.id, 'Message id');
    const raw = body.targets;
    if (!Array.isArray(raw) || !raw.length) resutils.createError('validationFailed', 'Choose at least one conversation.');
    const seen = new Set();
    const targets = raw.map((t) => ({
        conversationId: parseId(t?.conversation_id, 'Conversation id'),
        content: validateContent(t?.content),
        keyVersion: validateKeyVersion(t?.key_version)
    })).filter((t) => !seen.has(t.conversationId) && seen.add(t.conversationId));     // a chat chosen twice gets one copy
    if (targets.length > MAX_FORWARD_TARGETS) resutils.createError('validationFailed', `You can forward to at most ${MAX_FORWARD_TARGETS} conversations at once.`);
    return { messageId, targets };
};

exports.validateContent = validateContent;
exports.validateKeyVersion = validateKeyVersion;
exports.validateClientMessageId = validateClientMessageId;
exports.validateReplyToId = validateReplyToId;
exports.MAX_LENGTH = MAX_LENGTH;
