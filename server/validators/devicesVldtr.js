const resutils = require('../utils/response.utils');
const { log } = require('../utils/log.utils');

const PLATFORMS = ['android', 'ios'];

// an FCM token: plain text, no spaces, about 150-200 characters (512 is the column size)
const validateToken = (value) => {
    if (typeof value !== 'string' || !/^\S{20,512}$/.test(value.trim())) resutils.createError('validationFailed', 'push_token is missing or invalid.');
    return value.trim();
};

// POST /devices  { push_token, platform? }  - platform defaults to android
exports.validateRegister = (body = {}) => {
    log('in devices validateRegister');
    const pushToken = validateToken(body.push_token);
    const platform = body.platform === undefined ? 'android' : body.platform;
    if (!PLATFORMS.includes(platform)) resutils.createError('validationFailed', `platform must be one of: ${PLATFORMS.join(', ')}.`);
    return { pushToken, platform };
};

// POST /devices/unregister  { push_token }
exports.validateUnregister = (body = {}) => {
    log('in devices validateUnregister');
    return { pushToken: validateToken(body.push_token) };
};
