const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const messagesService = require('../services/messagesService');
const messagesVldtr = require('../validators/messagesVldtr');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// POST /messages  { conversation_id, content, client_message_id?, reply_to_message_id? }  - rest fallback for message:send
exports.send = async (req, res) => {
    log('in messages send');
    try {
        const { message, duplicate } = await messagesService.sendSrvc(req.user.user_id, messagesVldtr.validateSend(req.body || {}));
        return resutils.sendSuccessResponse(req, res, { message, duplicate }, duplicate ? RESPONSE_STATUS.SUCCESS : RESPONSE_STATUS.CREATED, { function: 'messages send' });
    } catch (error) {
        return sendChatError(req, res, error, 'messages send');
    }
};

// DELETE /messages/:id  - delete own message for everyone within the window
exports.deleteForEveryone = async (req, res) => {
    log('in messages deleteForEveryone');
    try {
        const { message, already } = await messagesService.deleteForEveryoneSrvc(req.user.user_id, messagesVldtr.messageId(req.params.id));
        return resutils.sendSuccessResponse(req, res, { message, already }, RESPONSE_STATUS.DELETED, { function: 'messages delete' });
    } catch (error) {
        return sendChatError(req, res, error, 'messages delete');
    }
};

// POST /messages/:id/delivered  - rest fallback for message:delivered
exports.markDelivered = async (req, res) => {
    log('in messages markDelivered');
    try {
        const result = await messagesService.markDeliveredSrvc(req.user.user_id, messagesVldtr.messageId(req.params.id));
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.SUCCESS, { function: 'messages mark delivered' });
    } catch (error) {
        return sendChatError(req, res, error, 'messages mark delivered');
    }
};

// shared shape of every chat controller: validate the request and run the service, answer with its result, map named errors
const handle = (fname, status, run) => async (req, res) => {
    log(`in ${fname}`);
    try {
        return resutils.sendSuccessResponse(req, res, await run(req), status, { function: fname });
    } catch (error) {
        return sendChatError(req, res, error, fname);
    }
};

// PATCH /messages/:id  { content }  - edit own message within the window
exports.edit = handle('messages edit', RESPONSE_STATUS.UPDATED, (req) => {
    const { messageId, content } = messagesVldtr.validateEdit(req.params, req.body || {});
    return messagesService.editSrvc(req.user.user_id, messageId, content);
});

// GET /messages/:id/edits  - every version of own message, oldest first
exports.editHistory = handle('messages edit history', RESPONSE_STATUS.DATA_FOUND, (req) => messagesService.editHistorySrvc(req.user.user_id, messagesVldtr.messageId(req.params.id)));

// POST /messages/:id/forward  { conversation_ids: [] }  - per-target results
exports.forward = handle('messages forward', RESPONSE_STATUS.SUCCESS, (req) => {
    const { messageId, conversationIds } = messagesVldtr.validateForward(req.params, req.body || {});
    return messagesService.forwardSrvc(req.user.user_id, messageId, conversationIds);
});

// GET /messages/:id/receipts  - message info in a group: each recipient's delivered / read time (sender only)
exports.receipts = handle('messages receipts', RESPONSE_STATUS.DATA_FOUND, (req) => messagesService.receiptsSrvc(req.user.user_id, messagesVldtr.messageId(req.params.id)));
