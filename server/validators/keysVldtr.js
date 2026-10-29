const resutils = require('../utils/response.utils');
const { parseId } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * Request rules for end-to-end encryption keys. Every key arrives as base64 made by the app; the server
 * cannot check what is inside (it cannot open any of it), only that each value is well-formed and of a
 * sensible size. The recovery code is accepted only to email it to the user: it is never stored.
 */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const RECOVERY_CODE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){5,7}$/;        // base32 in groups of four: XXXX-XXXX-...
const KDF_PARAMS = /^[a-z0-9=,]{1,100}$/;
const MAX_COPIES = 300;                                           // a chat key is locked once per member

// one base64 value of at most max characters (and at least min)
const base64 = (value, label, { min = 8, max = 255 } = {}) => {
    if (typeof value !== 'string' || value.length < min || value.length > max || !BASE64.test(value)) {
        resutils.createError('validationFailed', `${label} is missing or invalid.`);
    }
    return value;
};

const positiveInt = (value, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) resutils.createError('validationFailed', `${label} must be a whole number from 1.`);
    return n;
};

const recoveryCode = (value) => {
    if (typeof value !== 'string' || !RECOVERY_CODE.test(value)) resutils.createError('validationFailed', 'recovery_code is missing or invalid.');
    return value;
};

const kdfParams = (value) => {
    if (typeof value !== 'string' || !KDF_PARAMS.test(value)) resutils.createError('validationFailed', 'pw_kdf_params is missing or invalid.');
    return value;
};

// the whole set made at sign-up or "start fresh": padlock, both locked backups, and the recovery code to email
const validateKeySet = (body = {}) => ({
    publicKey: base64(body.public_key, 'public_key', { max: 64 }),
    pwLockedPrivateKey: base64(body.pw_locked_private_key, 'pw_locked_private_key'),
    pwKdfSalt: base64(body.pw_kdf_salt, 'pw_kdf_salt', { max: 64 }),
    pwKdfParams: kdfParams(body.pw_kdf_params),
    rcLockedPrivateKey: base64(body.rc_locked_private_key, 'rc_locked_private_key'),
    rcKdfSalt: base64(body.rc_kdf_salt, 'rc_kdf_salt', { max: 64 }),
    recoveryCode: recoveryCode(body.recovery_code)
});

// a password backup locked again; key_version + public_key say which keys it belongs to
const validatePasswordBackup = (body = {}) => ({
    keyVersion: positiveInt(body.key_version, 'key_version'),
    publicKey: base64(body.public_key, 'public_key', { max: 64 }),
    pwLockedPrivateKey: base64(body.pw_locked_private_key, 'pw_locked_private_key'),
    pwKdfSalt: base64(body.pw_kdf_salt, 'pw_kdf_salt', { max: 64 }),
    pwKdfParams: kdfParams(body.pw_kdf_params)
});

// POST /auth/signup: the keys travel with the account details, under `keys`
exports.validateSignUpKeys = (body = {}) => {
    log('in validateSignUpKeys');
    if (!body.keys || typeof body.keys !== 'object') resutils.createError('validationFailed', 'Encryption keys are missing. Please update the app.');
    return validateKeySet(body.keys);
};

// PUT /keys/me
exports.validateSetKeys = (body = {}) => {
    log('in validateSetKeys');
    return validateKeySet(body);
};

// PATCH /keys/me/password-backup
exports.validatePasswordBackup = (body = {}) => {
    log('in validatePasswordBackup');
    return validatePasswordBackup(body);
};

// POST /auth/update-password: the re-locked backup is optional (absent: the phone does not have the key)
exports.validateOptionalPasswordBackup = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object') resutils.createError('validationFailed', 'key_backup is invalid.');
    return validatePasswordBackup(value);
};

// PUT /keys/me/recovery  - a new recovery code
exports.validateRecovery = (body = {}) => {
    log('in validateRecovery');
    return {
        keyVersion: positiveInt(body.key_version, 'key_version'),
        publicKey: base64(body.public_key, 'public_key', { max: 64 }),
        rcLockedPrivateKey: base64(body.rc_locked_private_key, 'rc_locked_private_key'),
        rcKdfSalt: base64(body.rc_kdf_salt, 'rc_kdf_salt', { max: 64 }),
        recoveryCode: recoveryCode(body.recovery_code)
    };
};

// GET /keys/users?ids=1,2,3
exports.validateUserIds = (query = {}) => {
    log('in validateUserIds');
    const raw = typeof query.ids === 'string' ? query.ids.split(',').filter(Boolean) : [];
    if (!raw.length) resutils.createError('validationFailed', 'ids is required.');
    const ids = [...new Set(raw.map((id) => parseId(id, 'User id')))];
    if (ids.length > MAX_COPIES) resutils.createError('validationFailed', `At most ${MAX_COPIES} users at once.`);
    return ids;
};

// GET /keys/conversations?conversation_id=
exports.validateMyKeysQuery = (query = {}) => {
    log('in validateMyKeysQuery');
    if (query.conversation_id === undefined || query.conversation_id === '') return { conversationId: null };
    return { conversationId: parseId(query.conversation_id, 'Conversation id') };
};

// POST /conversations/:id/keys  { key_version, copies: [{ user_id, user_key_version, locked_key }] }
exports.validateCreateConversationKey = (params = {}, body = {}) => {
    log('in validateCreateConversationKey');
    const conversationId = parseId(params.id, 'Conversation id');
    const keyVersion = positiveInt(body.key_version, 'key_version');
    if (!Array.isArray(body.copies) || !body.copies.length) resutils.createError('validationFailed', 'copies must list one locked key per member.');
    if (body.copies.length > MAX_COPIES) resutils.createError('validationFailed', `At most ${MAX_COPIES} copies.`);
    const copies = body.copies.map((c) => ({
        userId: parseId(c?.user_id, 'User id'),
        userKeyVersion: positiveInt(c?.user_key_version, 'user_key_version'),
        lockedKey: base64(c?.locked_key, 'locked_key')
    }));
    if (new Set(copies.map((c) => c.userId)).size !== copies.length) resutils.createError('validationFailed', 'One copy per member.');
    return { conversationId, keyVersion, copies };
};

exports.conversationId = (value) => parseId(value, 'Conversation id');
