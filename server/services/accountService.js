const fs = require('fs');
const bcrypt = require('bcrypt');
const accountMdl = require('../models/accountMdl');
const authMdl = require('../models/authMdl');
const resutils = require('../utils/response.utils');
const fileutils = require('../utils/files.utils');
const appEvents = require('../utils/events.utils');
const { log } = require('../utils/log.utils');

/*
 * DELETE /profile: the account and everything it wrote, for good (accountMdl.deleteAccount says what goes
 * and in which order). The password is asked again, so a phone left unlocked cannot delete someone's
 * account. After the commit: the photo files leave the disk, the people it concerned update their chat
 * lists live, and every phone signed in to the account is disconnected.
 */
exports.deleteAccountSrvc = async (user, password) => {
    log('in deleteAccountSrvc');
    const [account] = await authMdl.getUserDetails({ email: user.email });
    if (!account || account.user_id !== Number(user.user_id)) resutils.createError('userNotFound', 'Account not found.');
    if (!(await bcrypt.compare(password, account.password_hash))) resutils.createError('wrongPassword', 'Incorrect password.');

    const result = await accountMdl.deleteAccount(account.user_id);
    if (result.refused) resutils.createError('userNotFound', 'Account not found.');

    for (const filePath of result.filePaths) {
        await fs.promises.unlink(fileutils.resolveStoredPath(filePath)).catch(() => {});   // already gone is fine
    }
    for (const { conversationId, userId } of result.directPartners) appEvents.emit('conversation.removed', { userId, conversationId });
    for (const { conversationId, memberIds } of result.groups) appEvents.emit('group.updated', { conversationId, userIds: memberIds });
    appEvents.emit('account.deleted', { userId: account.user_id });
    log(`[account] user ${account.user_id} deleted: ${result.directPartners.length} chats removed, ${result.groups.length} groups left, ${result.filePaths.length} files`);
    return { deleted: true };
};
