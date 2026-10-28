const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const appReleasesService = require('../services/appReleasesService');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// POST /app/releases  - the release script publishes a new build (x-release-key header)
exports.publish = async (req, res) => {
    log('in app publish');
    try {
        const result = await appReleasesService.publishSrvc(req.get('x-release-key'), req.body || {});
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.CREATED, { function: 'app publish' });
    } catch (error) {
        return sendChatError(req, res, error, 'app publish');
    }
};

// GET /app/latest?version_code=  - is there a newer app build, and must this one update first
exports.latest = async (req, res) => {
    log('in app latest');
    try {
        const result = await appReleasesService.latestSrvc(req.query.version_code);
        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.DATA_FOUND, { function: 'app latest' });
    } catch (error) {
        return sendChatError(req, res, error, 'app latest');
    }
};
