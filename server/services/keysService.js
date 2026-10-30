const keysMdl = require('../models/keysMdl');
const authMdl = require('../models/authMdl');
const conversationsService = require('./conversationsService');
const resutils = require('../utils/response.utils');
const emailutils = require('../utils/email.utils');
const appEvents = require('../utils/events.utils');
const { toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * End-to-end encryption keys (see keysMdl). This service never sees a private key, a chat key or a
 * password-derived key: only padlocks and locked boxes. The one secret that passes through is the
 * recovery code, on its way to the user's mailbox; it is neither stored nor logged.
 */
const APP_NAME = process.env.APP_NAME || 'YaapZone';

// what the app gets back about its own keys (both locked backups: it opens one with the password or the code)
const toKeysDto = (row) => row ? ({
    key_version: row.key_version,
    public_key: row.public_key,
    pw_locked_private_key: row.pw_locked_private_key,
    pw_kdf_salt: row.pw_kdf_salt,
    pw_kdf_params: row.pw_kdf_params,
    pw_backup_valid: !!row.pw_backup_valid,
    rc_locked_private_key: row.rc_locked_private_key,
    rc_kdf_salt: row.rc_kdf_salt,
    updated_at: toIso(row.updated_at)
}) : null;

// XXXX-XXXX-... -> XXXX-••••-••••-...: the email log keeps the mail, never the code
const maskCode = (code) => code.split('-').map((group, i) => (i === 0 ? group : '••••')).join('-');

const recoveryMail = (name, code) => `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2c3e50;">Your ${APP_NAME} recovery code</h2>
        <p>Hello ${name || 'there'},</p>
        <p>Your chats are end-to-end encrypted: only your phones can read them. If you ever forget your password
           and reset it on a phone that is not signed in, this code unlocks your old messages again.</p>
        <div style="display: inline-block; padding: 12px 18px; font-size: 20px; font-weight: bold; letter-spacing: 2px;
            font-family: monospace; color: #ffffff; background-color: #128C5E; border-radius: 6px; margin: 10px 0;">${code}</div>
        <p><strong>Keep this email.</strong> ${APP_NAME} does not store this code and cannot send it again.
           Anyone with this code and your email account could unlock your messages, so do not share it.</p>
        <br><p>Regards,<br><strong>Team ${APP_NAME}</strong></p>
        <hr><small style="color: #777;">This is an automated email. Please do not reply to this message.</small>
    </div>`;

/*
 * Mails the recovery code to the user. Best effort: the app also shows the code on screen, so a mail
 * that does not arrive never fails the sign-up. The email log gets the mail with the code masked.
 */
const sendRecoveryCodeSrvc = async ({ userId, email, name }, code) => {
    log('in sendRecoveryCodeSrvc');
    const subject = `Your ${APP_NAME} recovery code`;
    try {
        const [mail] = await emailutils.sendEmail([email], { subject, body: recoveryMail(name, code) });
        await authMdl.logEMail({
            to: email, subject, body: recoveryMail(name, maskCode(code)), status: mail?.success ? 'SUCCESS' : 'FAILED',
            messageId: mail?.messageId, response: mail?.success ? mail.response : mail?.error, key: null, reason: 'recovery-code'
        }, { user_id: userId });
        return !!mail?.success;
    } catch (error) {
        console.error('[keys] could not mail the recovery code:', error.message);
        return false;
    }
};

// the recovery-code mail goes out after the answer: the user already sees the code on screen, so a slow
// or failing mail server must never hold up (or fail) a sign-up. the outcome is in the email log
const queueRecoveryCodeEmail = (who, code) => {
    setImmediate(() => { sendRecoveryCodeSrvc(who, code).catch(() => {}); });
};

// GET /keys/me
exports.getMyKeysSrvc = async (userId) => {
    log('in getMyKeysSrvc');
    const [row] = await keysMdl.getUserKeys(userId);
    if (!row) resutils.createError('noKeys', 'No encryption keys found for this account.');
    return { keys: toKeysDto(row) };
};

// used by sign-in: the keys or null (an account made before encryption has none yet)
exports.findMyKeysSrvc = async (userId) => {
    const [row] = await keysMdl.getUserKeys(userId);
    return toKeysDto(row);
};

// PUT /keys/me: first keys for an account without any, or "start fresh"
exports.setMyKeysSrvc = async (user, keys) => {
    log('in setMyKeysSrvc');
    const keyVersion = await keysMdl.setUserKeys(user.user_id, keys);
    queueRecoveryCodeEmail({ userId: user.user_id, email: user.email, name: user.first_nm }, keys.recoveryCode);
    appEvents.emit('keys.changed', { userId: user.user_id, keyVersion });
    const [row] = await keysMdl.getUserKeys(user.user_id);
    return { keys: toKeysDto(row), recovery_code_emailed: true };
};

// PATCH /keys/me/password-backup: after a recovery (or any time the app holds the key)
exports.updatePasswordBackupSrvc = async (userId, backup) => {
    log('in updatePasswordBackupSrvc');
    const result = await keysMdl.updatePasswordBackup(userId, backup);
    if (!result.affectedRows) resutils.createError('keysMismatch', 'Your encryption keys changed on another device. Sign in again.');
    return { updated: true };
};

// PUT /keys/me/recovery: a new recovery code replaces the old one (and is mailed)
exports.updateRecoverySrvc = async (user, recovery) => {
    log('in updateRecoverySrvc');
    const result = await keysMdl.updateRecoveryBackup(user.user_id, recovery);
    if (!result.affectedRows) resutils.createError('keysMismatch', 'Your encryption keys changed on another device. Sign in again.');
    queueRecoveryCodeEmail({ userId: user.user_id, email: user.email, name: user.first_nm }, recovery.recoveryCode);
    return { updated: true, recovery_code_emailed: true };
};

// GET /keys/users?ids=: padlocks (users without keys are simply missing from the answer)
exports.publicKeysSrvc = async (userIds) => {
    log('in publicKeysSrvc');
    const rows = await keysMdl.getPublicKeys(userIds);
    return { keys: rows.map((r) => ({ user_id: r.user_id, key_version: r.key_version, public_key: r.public_key })) };
};

// GET /keys/conversations: the caller's locked copies of chat keys
exports.myConversationKeysSrvc = async (userId, conversationId) => {
    log('in myConversationKeysSrvc');
    if (conversationId) await conversationsService.assertReaderSrvc(conversationId, userId);
    const rows = await keysMdl.listMyConversationKeys(userId, conversationId);
    return { keys: rows.map((r) => ({ conversation_id: r.conversation_id, key_version: r.key_version, user_key_version: r.user_key_version, locked_key: r.locked_key })) };
};

// GET /conversations/:id/keys: what the app needs to make the next chat key version
exports.keyStateSrvc = async (userId, conversationId) => {
    log('in keyStateSrvc');
    await conversationsService.assertMemberSrvc(conversationId, userId);
    const { state, members } = await keysMdl.getKeyState(conversationId);
    if (!state) resutils.createError('conversationNotFound', 'Conversation not found.');
    return {
        conversation_id: conversationId,
        current_key_version: state.current_key_version,
        needs_new_key: !!state.needs_new_key,
        // members without keys yet (an account from before encryption) get no copy until they make keys
        members: members.map((m) => ({ user_id: m.user_id, key_version: m.key_version ?? null, public_key: m.public_key ?? null }))
    };
};

// POST /conversations/:id/keys: a new chat key version, locked once per member
exports.createConversationKeySrvc = async (userId, { conversationId, keyVersion, copies }) => {
    log('in createConversationKeySrvc');
    await conversationsService.assertMemberSrvc(conversationId, userId);
    const result = await keysMdl.createConversationKey({ conversationId, keyVersion, createdBy: Number(userId), copies }).catch((error) => {
        // another phone made this version a moment earlier
        if (error.code === 'ER_DUP_ENTRY') return { refused: 'keyConflict' };
        throw error;
    });
    if (result.refused === 'notMember') resutils.createError('notMember', 'You are not a member of this conversation.');
    if (result.refused === 'conversationNotFound') resutils.createError('conversationNotFound', 'Conversation not found.');
    if (result.refused) resutils.createError('keyConflict', 'The chat members or keys changed. Fetch the key state and try again.');
    appEvents.emit('conversation.key', { conversation_id: conversationId, key_version: result.keyVersion, memberIds: result.memberIds });
    return { conversation_id: conversationId, key_version: result.keyVersion };
};

exports.sendRecoveryCodeSrvc = sendRecoveryCodeSrvc;
exports.queueRecoveryCodeEmail = queueRecoveryCodeEmail;
exports.toKeysDto = toKeysDto;
