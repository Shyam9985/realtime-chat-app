const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

/*
 * End-to-end encryption keys. The server only ever stores what it cannot open: each user's public
 * key (the padlock), their private key locked twice (with a key made from the password, and with the
 * recovery code), and every member's locked copy of each chat key version. Nothing here can decrypt.
 */
const USER_KEYS_SELECT = `select user_id, key_version, public_key, pw_locked_private_key, pw_kdf_salt, pw_kdf_params, pw_backup_valid,
        rc_locked_private_key, rc_kdf_salt, updated_at
    from user_keys_t`;

// the user's keys row (their padlock and both locked backups), or nothing
exports.getUserKeys = (userId) => {
    log('in getUserKeys');
    return dbutils.executeQuery(`${USER_KEYS_SELECT} where user_id = ? and is_active = 1`, [userId], 'get user keys');
};

// the padlocks of these users (anyone may have a padlock: it only locks)
exports.getPublicKeys = (userIds) => {
    log('in getPublicKeys');
    const qry = `select k.user_id, k.key_version, k.public_key from user_keys_t k
        join users_lst_t u on u.user_id = k.user_id and u.is_active = 1
        where k.is_active = 1 and k.user_id in (${userIds.map(() => '?').join(', ')})`;
    return dbutils.executeQuery(qry, userIds, 'get public keys');
};

const insertKeysRow = (connection, userId, k) => connection.execute(
    `insert into user_keys_t (user_id, key_version, public_key, pw_locked_private_key, pw_kdf_salt, pw_kdf_params, pw_backup_valid, rc_locked_private_key, rc_kdf_salt)
        values (?, 1, ?, ?, ?, ?, 1, ?, ?)`,
    [userId, k.publicKey, k.pwLockedPrivateKey, k.pwKdfSalt, k.pwKdfParams, k.rcLockedPrivateKey, k.rcKdfSalt]);

// sign-up: the user row and their keys in one transaction, so no account ever exists without keys
exports.signUpWithKeys = ({ user, keys }) => {
    log('in signUpWithKeys');
    return dbutils.executeTransaction(async (connection) => {
        const [result] = await connection.execute(
            'insert into users_lst_t (user_nm, first_nm, last_nm, mobile_no, date_of_birth, email, password_hash, password_salt) values (?, ?, ?, ?, ?, ?, ?, ?)',
            [user.email, user.fst_nm, user.lst_nm || null, user.mobile || null, user.date_of_birth.trim(), user.email, user.passwordHash, user.saltKey]);
        await insertKeysRow(connection, result.insertId, keys);
        return { userId: result.insertId };
    }, 'sign up with keys');
};

/*
 * First keys for an account that has none, or "start fresh" (a new padlock, key_version + 1). Either
 * way the user's chats need a new chat key their new padlock can open: every chat that already has
 * one is flagged, and the next sender's app makes the new version. Returns the new key_version.
 */
exports.setUserKeys = (userId, k) => {
    log('in setUserKeys');
    return dbutils.executeTransaction(async (connection) => {
        const [[row]] = await connection.execute('select key_version from user_keys_t where user_id = ? for update', [userId]);
        let keyVersion = 1;
        if (row) {
            keyVersion = row.key_version + 1;
            await connection.execute(
                `update user_keys_t set key_version = ?, public_key = ?, pw_locked_private_key = ?, pw_kdf_salt = ?, pw_kdf_params = ?, pw_backup_valid = 1,
                    rc_locked_private_key = ?, rc_kdf_salt = ?, is_active = 1 where user_id = ?`,
                [keyVersion, k.publicKey, k.pwLockedPrivateKey, k.pwKdfSalt, k.pwKdfParams, k.rcLockedPrivateKey, k.rcKdfSalt, userId]);
        } else {
            await insertKeysRow(connection, userId, k);
        }
        await connection.execute(
            `update conversations_lst_t c join conversation_members_t m on m.conversation_id = c.conversation_id
                set c.needs_new_key = 1
                where m.user_id = ? and m.is_active = 1 and m.left_at is null and c.current_key_version > 0`,
            [userId]);
        return keyVersion;
    }, 'set user keys');
};

// the password backup locked again (with the new password, or after a recovery); only for the keys it
// was made from: a backup of an old padlock must not replace the current one
exports.updatePasswordBackup = (userId, b) => {
    log('in updatePasswordBackup');
    const qry = `update user_keys_t set pw_locked_private_key = ?, pw_kdf_salt = ?, pw_kdf_params = ?, pw_backup_valid = 1
        where user_id = ? and key_version = ? and public_key = ? and is_active = 1`;
    return dbutils.executeQuery(qry, [b.pwLockedPrivateKey, b.pwKdfSalt, b.pwKdfParams, userId, b.keyVersion, b.publicKey], 'update password backup');
};

// a new recovery code: the recovery backup locked again with it (same padlock rule as above)
exports.updateRecoveryBackup = (userId, b) => {
    log('in updateRecoveryBackup');
    const qry = `update user_keys_t set rc_locked_private_key = ?, rc_kdf_salt = ?
        where user_id = ? and key_version = ? and public_key = ? and is_active = 1`;
    return dbutils.executeQuery(qry, [b.rcLockedPrivateKey, b.rcKdfSalt, userId, b.keyVersion, b.publicKey], 'update recovery backup');
};

/*
 * A new password and the key backup that goes with it, in ONE transaction: both change or neither.
 * backup null (a forgotten password reset on a phone without the key): the old backup is still
 * locked with the old password, so it is marked out of date and the app asks for the recovery code.
 * Returns the number of user rows changed (0: no active account with that email).
 */
exports.updatePasswordWithBackup = ({ email, passwordHash, saltKey, backup }) => {
    log('in updatePasswordWithBackup');
    return dbutils.executeTransaction(async (connection) => {
        const [[user]] = await connection.execute('select user_id from users_lst_t where is_active = 1 and user_nm = ? for update', [email]);
        if (!user) return { changed: 0 };
        await connection.execute(
            'update users_lst_t set password_hash = ?, password_salt = ?, is_locked = 0, login_attempts = 0, locked_until = null where user_id = ?',
            [passwordHash, saltKey, user.user_id]);
        let backupUpdated = 0;
        if (backup) {
            const [result] = await connection.execute(
                `update user_keys_t set pw_locked_private_key = ?, pw_kdf_salt = ?, pw_kdf_params = ?, pw_backup_valid = 1
                    where user_id = ? and key_version = ? and public_key = ? and is_active = 1`,
                [backup.pwLockedPrivateKey, backup.pwKdfSalt, backup.pwKdfParams, user.user_id, backup.keyVersion, backup.publicKey]);
            backupUpdated = result.affectedRows;
        }
        if (!backupUpdated) {
            await connection.execute('update user_keys_t set pw_backup_valid = 0 where user_id = ? and is_active = 1', [user.user_id]);
        }
        return { changed: 1, userId: user.user_id, backupUpdated: !!backupUpdated };
    }, 'update password with key backup');
};

// ---- chat keys ----

// the caller's locked copies of chat keys: every version of every chat they are in (or one chat)
exports.listMyConversationKeys = (userId, conversationId = null) => {
    log('in listMyConversationKeys');
    const qry = `select k.conversation_id, k.key_version, k.user_key_version, k.locked_key
        from conversation_keys_t k
        where k.user_id = ? and k.is_active = 1 ${conversationId ? 'and k.conversation_id = ?' : ''}
        order by k.conversation_id, k.key_version`;
    return dbutils.executeQuery(qry, conversationId ? [userId, conversationId] : [userId], 'list my conversation keys');
};

// what a member's app needs to make the next version: the current one, whether a new one is due, and
// the padlocks of everyone it must be locked for (current members who have keys)
exports.getKeyState = async (conversationId) => {
    log('in getKeyState');
    const [state] = await dbutils.executeQuery(
        'select current_key_version, needs_new_key from conversations_lst_t where conversation_id = ? and is_active = 1',
        [conversationId], 'get key state');
    const members = await dbutils.executeQuery(
        `select m.user_id, k.key_version, k.public_key from conversation_members_t m
            left join user_keys_t k on k.user_id = m.user_id and k.is_active = 1
            where m.conversation_id = ? and m.is_active = 1 and m.left_at is null`,
        [conversationId], 'get key state members');
    return { state, members };
};

/*
 * A new chat key version: one locked copy per current member with keys. Runs on the locked conversation
 * row, so it is checked against the members and padlocks as they are at that moment: a member who just
 * joined or left, or someone's new padlock, refuses it (the app fetches the state and tries again).
 * Two phones making the same version at once: the unique key lets only the first one in.
 */
exports.createConversationKey = ({ conversationId, keyVersion, createdBy, copies }) => {
    log('in createConversationKey');
    return dbutils.executeTransaction(async (connection) => {
        const [[conv]] = await connection.execute(
            'select current_key_version from conversations_lst_t where conversation_id = ? and is_active = 1 for update', [conversationId]);
        if (!conv) return { refused: 'conversationNotFound' };
        if (keyVersion !== conv.current_key_version + 1) return { refused: 'keyConflict', current: conv.current_key_version };

        const [members] = await connection.execute(
            `select m.user_id, k.key_version from conversation_members_t m
                join user_keys_t k on k.user_id = m.user_id and k.is_active = 1
                where m.conversation_id = ? and m.is_active = 1 and m.left_at is null`,
            [conversationId]);
        if (!members.some((m) => m.user_id === createdBy)) return { refused: 'notMember' };
        const expected = new Map(members.map((m) => [m.user_id, m.key_version]));
        const complete = copies.length === expected.size && copies.every((c) => expected.get(c.userId) === c.userKeyVersion);
        if (!complete) return { refused: 'keyConflict', current: conv.current_key_version };

        await connection.execute(
            `insert into conversation_keys_t (conversation_id, key_version, user_id, user_key_version, locked_key, created_by)
                values ${copies.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
            copies.flatMap((c) => [conversationId, keyVersion, c.userId, c.userKeyVersion, c.lockedKey, createdBy]));
        await connection.execute(
            'update conversations_lst_t set current_key_version = ?, needs_new_key = 0 where conversation_id = ?', [keyVersion, conversationId]);
        return { keyVersion, memberIds: members.map((m) => m.user_id) };
    }, 'create conversation key');
};
