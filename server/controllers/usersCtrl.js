const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const usersService = require('../services/usersService');
const { statusForError, clientMessageForError } = require('../utils/chat.errors');
const { log } = require('../utils/log.utils');

// every chat controller reports failures the same way: named service errors map to a status,
// anything unexpected is logged in full and answered with the generic message only
const sendChatError = (req, res, error, fname) => {
    console.log(`Error in ${fname}:`, error?.message || error);
    return resutils.sendErrorResponse(req, res, clientMessageForError(error), statusForError(error), { function: fname });
};

// GET /users?query=&limit=
exports.search = async (req, res) => {
    log('in users search');
    try {
        const users = await usersService.searchSrvc(req.user.user_id, req.query.query, req.query.limit);
        // an empty result is a normal answer to a search, so it is always a 200 with an empty list
        return resutils.sendSuccessResponse(req, res, { users }, RESPONSE_STATUS.DATA_FOUND, { function: 'users search' });
    } catch (error) {
        return sendChatError(req, res, error, 'users search');
    }
};

// GET /users/blocked
exports.listBlocked = async (req, res) => {
    log('in users listBlocked');
    try {
        const users = await usersService.listBlockedSrvc(req.user.user_id);
        return resutils.sendSuccessResponse(req, res, { users }, RESPONSE_STATUS.DATA_FOUND, { function: 'users list blocked' });
    } catch (error) {
        return sendChatError(req, res, error, 'users list blocked');
    }
};

// POST /users/:id/block
exports.block = async (req, res) => {
    log('in users block');
    try {
        const result = await usersService.blockSrvc(req.user.user_id, req.params.id);
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.SUCCESS, { function: 'users block' });
    } catch (error) {
        return sendChatError(req, res, error, 'users block');
    }
};

// DELETE /users/:id/block
exports.unblock = async (req, res) => {
    log('in users unblock');
    try {
        const result = await usersService.unblockSrvc(req.user.user_id, req.params.id);
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.SUCCESS, { function: 'users unblock' });
    } catch (error) {
        return sendChatError(req, res, error, 'users unblock');
    }
};

// GET /users/:id - another member's public profile
exports.getProfile = async (req, res) => {
    log('in users getProfile');
    try {
        const user = await usersService.getProfileSrvc(req.user.user_id, req.params.id);
        return resutils.sendSuccessResponse(req, res, { user }, RESPONSE_STATUS.DATA_FOUND, { function: 'users get profile' });
    } catch (error) {
        return sendChatError(req, res, error, 'users get profile');
    }
};

exports.sendChatError = sendChatError;
