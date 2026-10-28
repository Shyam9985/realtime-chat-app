const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const devicesService = require('../services/devicesService');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// run the service, answer with its result, map named errors (the same shape as the chat controllers)
const handle = (fname, status, run) => async (req, res) => {
    log(`in ${fname}`);
    try {
        return resutils.sendSuccessResponse(req, res, await run(req), status, { function: fname });
    } catch (error) {
        return sendChatError(req, res, error, fname);
    }
};

// POST /devices  { push_token, platform? }
exports.register = handle('devices register', RESPONSE_STATUS.SUCCESS, (req) => devicesService.registerSrvc(req.user.user_id, req.body || {}));

// POST /devices/unregister  { push_token }
exports.unregister = handle('devices unregister', RESPONSE_STATUS.SUCCESS, (req) => devicesService.unregisterSrvc(req.user.user_id, req.body || {}));
