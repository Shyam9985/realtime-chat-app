const devicesMdl = require('../models/devicesMdl');
const { log } = require('../utils/log.utils');

// the token and platform come checked from devicesVldtr

// POST /devices  { push_token, platform? }  - the phone that will receive this user's notifications
exports.registerSrvc = async (userId, { pushToken, platform }) => {
    log('in registerSrvc (device)');
    await devicesMdl.register(Number(userId), pushToken, platform);
    return { registered: true };
};

// POST /devices/unregister  { push_token }  - sign-out: this phone stops getting the user's notifications
exports.unregisterSrvc = async (userId, { pushToken }) => {
    log('in unregisterSrvc (device)');
    const result = await devicesMdl.unregister(Number(userId), pushToken);
    return { unregistered: result.affectedRows > 0 };
};
