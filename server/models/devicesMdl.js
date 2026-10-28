const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// this phone now belongs to this user. the token is unique, so a phone that another account used
// before moves over instead of getting a second row. the row is locked while it is decided, and a
// lost insert race (both inserting the same new token) shows up as ER_DUP_ENTRY and is retried once
exports.register = (userId, pushToken, platform, retry = true) => {
    log('in register device');
    return dbutils.executeTransaction(async (connection) => {
        const [[row]] = await connection.execute('select device_id from user_devices_t where push_token = ? for update', [pushToken]);
        if (row) {
            await connection.execute(
                'update user_devices_t set user_id = ?, platform = ?, is_active = 1, last_registered_at = now(3) where device_id = ?',
                [userId, platform, row.device_id]);
        } else {
            await connection.execute('insert into user_devices_t (user_id, push_token, platform) values (?, ?, ?)', [userId, pushToken, platform]);
        }
    }, 'register device').catch((error) => {
        if (retry && error.code === 'ER_DUP_ENTRY') return exports.register(userId, pushToken, platform, false);
        throw error;
    });
};

// the push addresses of these users' phones that are still switched on
exports.listActiveTokens = (userIds) => {
    log('in listActiveTokens');
    if (!userIds.length) return Promise.resolve([]);
    const qry = `select user_id, push_token from user_devices_t where is_active = 1 and user_id in (${userIds.map(() => '?').join(', ')})`;
    return dbutils.executeQuery(qry, userIds, 'list active push tokens');
};

// every phone that is switched on, whoever it belongs to (announcing a new app version)
exports.listAllActiveTokens = () => {
    log('in listAllActiveTokens');
    return dbutils.executeQuery('select user_id, push_token from user_devices_t where is_active = 1', [], 'list all push tokens');
};

// firebase said these tokens no longer reach a phone (app uninstalled, data cleared): stop using them
exports.deactivateTokens = (pushTokens) => {
    log('in deactivateTokens');
    if (!pushTokens.length) return Promise.resolve({ affectedRows: 0 });
    const qry = `update user_devices_t set is_active = 0 where push_token in (${pushTokens.map(() => '?').join(', ')})`;
    return dbutils.executeQuery(qry, pushTokens, 'deactivate push tokens');
};

// sign-out: only the caller's own row for that token is switched off
exports.unregister = (userId, pushToken) => {
    log('in unregister device');
    const qry = 'update user_devices_t set is_active = 0 where user_id = ? and push_token = ? and is_active = 1';
    return dbutils.executeQuery(qry, [userId, pushToken], 'unregister device');
};
