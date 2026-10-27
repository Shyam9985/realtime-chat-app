const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const validutils = require('../utils/validate.utils');
const conversationsService = require('../services/conversationsService');
const messagesService = require('../services/messagesService');
const scheduledService = require('../services/scheduledService');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// GET /conversations
exports.list = async (req, res) => {
    log('in conversations list');
    try {
        const conversations = await conversationsService.listSrvc(req.user.user_id);
        return resutils.sendSuccessResponse(req, res, { conversations }, RESPONSE_STATUS.DATA_FOUND, { function: 'conversations list' });
    } catch (error) {
        return sendChatError(req, res, error, 'conversations list');
    }
};

// POST /conversations  { user_id }  -> the one-to-one conversation with that user, created if needed
exports.getOrCreate = async (req, res) => {
    log('in conversations getOrCreate');
    try {
        const validation = await validutils.validatePayload(req.body || {}, {
            user_id: { required: true, type: 'number', label: 'User id' }
        });
        if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);

        const { conversation, created } = await conversationsService.getOrCreateDirectSrvc(req.user.user_id, req.body.user_id);
        return resutils.sendSuccessResponse(req, res, { conversation, created }, created ? RESPONSE_STATUS.CREATED : RESPONSE_STATUS.DATA_FOUND, { function: 'conversations get or create' });
    } catch (error) {
        return sendChatError(req, res, error, 'conversations get or create');
    }
};

// GET /conversations/:id/messages?cursor=&limit=
exports.history = async (req, res) => {
    log('in conversations history');
    try {
        const page = await messagesService.historySrvc(req.user.user_id, req.params.id, req.query.cursor, req.query.limit);
        return resutils.sendSuccessResponse(req, res, page, RESPONSE_STATUS.DATA_FOUND, { function: 'conversations history' });
    } catch (error) {
        return sendChatError(req, res, error, 'conversations history');
    }
};

// POST /conversations/:id/seen  - rest fallback for the message:seen socket event
exports.markSeen = async (req, res) => {
    log('in conversations markSeen');
    try {
        const result = await messagesService.markSeenSrvc(req.user.user_id, req.params.id);
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.SUCCESS, { function: 'conversations mark seen' });
    } catch (error) {
        return sendChatError(req, res, error, 'conversations mark seen');
    }
};

// shared shape of every chat controller: run the service, answer with its result, map named errors
const handle = (fname, status, run) => async (req, res) => {
    log(`in ${fname}`);
    try {
        return resutils.sendSuccessResponse(req, res, await run(req), status, { function: fname });
    } catch (error) {
        return sendChatError(req, res, error, fname);
    }
};

// PATCH /conversations/:id/settings  { is_pinned?, is_archived?, custom_title? }  - this member only
exports.updateSettings = handle('conversations settings', RESPONSE_STATUS.UPDATED, (req) => conversationsService.updateSettingsSrvc(req.user.user_id, req.params.id, req.body || {}));

// POST /conversations/read-all  - mark every conversation with unread messages as seen
exports.readAll = handle('conversations read all', RESPONSE_STATUS.SUCCESS, (req) => messagesService.markAllSeenSrvc(req.user.user_id));

// GET /conversations/:id/messages/search?q=&limit=
exports.search = handle('conversations search', RESPONSE_STATUS.DATA_FOUND, (req) => messagesService.searchSrvc(req.user.user_id, req.params.id, req.query.q, req.query.limit));

// GET / POST /conversations/:id/scheduled  - the caller's scheduled messages in this conversation
exports.listScheduled = handle('scheduled list', RESPONSE_STATUS.DATA_FOUND, (req) => scheduledService.listSrvc(req.user.user_id, req.params.id));
exports.createScheduled = handle('scheduled create', RESPONSE_STATUS.CREATED, (req) => scheduledService.createSrvc(req.user.user_id, req.params.id, req.body || {}));

// PATCH / DELETE /scheduled/:id  - change or cancel a pending scheduled message
exports.updateScheduled = handle('scheduled update', RESPONSE_STATUS.UPDATED, (req) => scheduledService.updateSrvc(req.user.user_id, req.params.id, req.body || {}));
exports.cancelScheduled = handle('scheduled cancel', RESPONSE_STATUS.DELETED, (req) => scheduledService.cancelSrvc(req.user.user_id, req.params.id));
