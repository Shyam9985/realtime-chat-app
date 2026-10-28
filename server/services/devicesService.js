const devicesMdl = require('../models/devicesMdl');
const resutils = require('../utils/response.utils');
const { log } = require('../utils/log.utils');

const PLATFORMS = ['android', 'ios'];

// an FCM token: plain text, no spaces, about 150-200 characters (512 is the column size)
const validateToken = (value) => {
    if (typeof value !== 'string' || !/^\S{20,512}$/.test(value.trim())) resutils.createError('validationFailed', 'push_token is missing or invalid.');
    return value.trim();
};

// POST /devices  { push_token, platform? }  - the phone that will receive this user's notifications
exports.registerSrvc = async (userId, body = {}) => {
    log('in registerSrvc (device)');
    const pushToken = validateToken(body.push_token);
    const platform = body.platform === undefined ? 'android' : body.platform;
    if (!PLATFORMS.includes(platform)) resutils.createError('validationFailed', `platform must be one of: ${PLATFORMS.join(', ')}.`);
    await devicesMdl.register(Number(userId), pushToken, platform);
    return { registered: true };
};

// POST /devices/unregister  { push_token }  - sign-out: this phone stops getting the user's notifications
exports.unregisterSrvc = async (userId, body = {}) => {
    log('in unregisterSrvc (device)');
    const result = await devicesMdl.unregister(Number(userId), validateToken(body.push_token));
    return { unregistered: result.affectedRows > 0 };
};
