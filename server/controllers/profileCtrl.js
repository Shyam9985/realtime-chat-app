const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const profileService = require('../services/profileService');
const { log } = require('../utils/log.utils');

// maps profile error names to standard responses, mirroring the other controllers
const sendProfileError = (req, res, error, fname) => {
    console.log('Error in ' + fname + ' : ', error);

    if (error.name === 'noUser') {
        return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.NO_DATA_FOUND, { function: fname });
    }

    return resutils.sendErrorResponse(req, res, 'We could not load your profile right now. Please try again in a moment.',
        RESPONSE_STATUS.INTERNAL_SERVER_ERROR, { function: fname });
};

// profile controller - fresh user details for the logged in user (req.user is set by auth middleware)
exports.getProfile = async (req, res) => {
    log('in getProfile');
    try {
        const result = await profileService.getProfileSrvc(req.user.user_id);

        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.DATA_FOUND, { function: 'get profile controller' });
    } catch (error) {
        return sendProfileError(req, res, error, 'get profile controller');
    }
}
