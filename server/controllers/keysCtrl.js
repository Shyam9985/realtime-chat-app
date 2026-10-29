const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const keysService = require('../services/keysService');
const keysVldtr = require('../validators/keysVldtr');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// validate the request, run the service, answer with its result, map named errors (the same shape as the chat controllers)
const handle = (fname, status, run) => async (req, res) => {
    log(`in ${fname}`);
    try {
        return resutils.sendSuccessResponse(req, res, await run(req), status, { function: fname });
    } catch (error) {
        return sendChatError(req, res, error, fname);
    }
};

// GET /keys/me  - the caller's padlock and locked backups
exports.getMine = handle('keys get mine', RESPONSE_STATUS.DATA_FOUND, (req) => keysService.getMyKeysSrvc(req.user.user_id));

// PUT /keys/me  - first keys, or "start fresh"  { public_key, pw_*, rc_*, recovery_code }
exports.setMine = handle('keys set mine', RESPONSE_STATUS.UPDATED, (req) => keysService.setMyKeysSrvc(req.user, keysVldtr.validateSetKeys(req.body || {})));

// PATCH /keys/me/password-backup  { key_version, public_key, pw_locked_private_key, pw_kdf_salt, pw_kdf_params }
exports.updatePasswordBackup = handle('keys password backup', RESPONSE_STATUS.UPDATED, (req) => keysService.updatePasswordBackupSrvc(req.user.user_id, keysVldtr.validatePasswordBackup(req.body || {})));

// PUT /keys/me/recovery  - a new recovery code  { key_version, public_key, rc_locked_private_key, rc_kdf_salt, recovery_code }
exports.updateRecovery = handle('keys recovery', RESPONSE_STATUS.UPDATED, (req) => keysService.updateRecoverySrvc(req.user, keysVldtr.validateRecovery(req.body || {})));

// GET /keys/users?ids=1,2  - padlocks
exports.publicKeys = handle('keys public', RESPONSE_STATUS.DATA_FOUND, (req) => keysService.publicKeysSrvc(keysVldtr.validateUserIds(req.query)));

// GET /keys/conversations?conversation_id=  - the caller's locked copies of chat keys
exports.myConversationKeys = handle('keys my conversations', RESPONSE_STATUS.DATA_FOUND, (req) => keysService.myConversationKeysSrvc(req.user.user_id, keysVldtr.validateMyKeysQuery(req.query).conversationId));

// GET /conversations/:id/keys  - current version, whether a new one is due, members' padlocks
exports.keyState = handle('keys state', RESPONSE_STATUS.DATA_FOUND, (req) => keysService.keyStateSrvc(req.user.user_id, keysVldtr.conversationId(req.params.id)));

// POST /conversations/:id/keys  { key_version, copies: [{ user_id, user_key_version, locked_key }] }
exports.createConversationKey = handle('keys create conversation key', RESPONSE_STATUS.CREATED, (req) => keysService.createConversationKeySrvc(req.user.user_id, keysVldtr.validateCreateConversationKey(req.params, req.body || {})));
