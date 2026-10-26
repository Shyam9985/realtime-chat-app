const { applyCacheHeaders, CACHE_TYPES } = require('./cache.utils');
const RESPONSE_STATUS = require('./standard.messages');
const auditService = require('../services/auditService');

// success response function
const sendSuccessResponse = (req, res, data = null, status = RESPONSE_STATUS.SUCCESS, meta = {}) => {

    applyCacheHeaders(res, meta.cacheType || CACHE_TYPES.NO_STORE);
    res.locals.statusKey = status.statusKey;   // picked up by the request logger
    auditService.log(req, res, auditService.AUDIT_STATUS.SUCCESS, { message: status.message, data });   // only when the route is marked with audit()

    return res.status(status.code).json({
        success: true, code: status.code, statusKey: status.statusKey, message: status.message, data
    });
};

// error respponse function
const sendErrorResponse = (req, res, error = null, status = RESPONSE_STATUS.INTERNAL_SERVER_ERROR, meta = {}) => {
    
    applyCacheHeaders(res, meta.cacheType || CACHE_TYPES.NO_STORE);
    res.locals.statusKey = status.statusKey;
    if (!res.locals.error) res.locals.error = error;
    auditService.log(req, res, auditService.AUDIT_STATUS.FAILED, { message: status.message, error });   // only when the route is marked with audit()

    return res.status(status.code).json({ success: false, code: status.code, statusKey: status.statusKey, message: status.message, error });
};

// progress response
const sendProgressResponse = (req, res, progress = 0, completed = false, data = null, status = RESPONSE_STATUS.OK) => {
    
    applyCacheHeaders(res, meta.cacheType || CACHE_TYPES.NO_STORE);

    const payload = { success: true, code: status.code, statusKey: status.statusKey, message: status.message, progress, completed };
    if (data) payload.data = data;
    res.write(JSON.stringify(payload) + '\n');
    if (completed) res.end();
};

const createError = (name, message) => {
    const err = new Error(message);
    err.name = name;
    throw err;
};

module.exports = { sendSuccessResponse, sendErrorResponse, sendProgressResponse, createError };