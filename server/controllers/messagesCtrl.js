const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const messagesService = require('../services/messagesService');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// POST /messages  { conversation_id, content, client_message_id? }  - rest fallback for message:send
exports.send = async (req, res) => {
    log('in messages send');
    try {
        const { message, duplicate } = await messagesService.sendSrvc(req.user.user_id, req.body || {});
        return resutils.sendSuccessResponse(req, res, { message, duplicate }, duplicate ? RESPONSE_STATUS.SUCCESS : RESPONSE_STATUS.CREATED, { function: 'messages send' });
    } catch (error) {
        return sendChatError(req, res, error, 'messages send');
    }
};

// DELETE /messages/:id  - delete own message for everyone within the window
exports.deleteForEveryone = async (req, res) => {
    log('in messages deleteForEveryone');
    try {
        const { message, already } = await messagesService.deleteForEveryoneSrvc(req.user.user_id, req.params.id);
        return resutils.sendSuccessResponse(req, res, { message, already }, RESPONSE_STATUS.DELETED, { function: 'messages delete' });
    } catch (error) {
        return sendChatError(req, res, error, 'messages delete');
    }
};

// POST /messages/:id/delivered  - rest fallback for message:delivered
exports.markDelivered = async (req, res) => {
    log('in messages markDelivered');
    try {
        const result = await messagesService.markDeliveredSrvc(req.user.user_id, req.params.id);
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.SUCCESS, { function: 'messages mark delivered' });
    } catch (error) {
        return sendChatError(req, res, error, 'messages mark delivered');
    }
};
