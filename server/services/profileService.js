const profileMdl = require('../models/profileMdl');
const conversationsMdl = require('../models/conversationsMdl');
const conversationsService = require('./conversationsService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { buildUserObj } = require('./authService');
const { log } = require('../utils/log.utils');

// returns a fresh profile for the logged in user, shaped exactly like the login payload, plus the
// date of birth (private: only the user sees it, it is not in the token or on their public profile).
// users_lst_t.profile_photo_url points at the current photo; uploaded_files_lst_t is history
exports.getProfileSrvc = async (user_id) => {
    log('in getProfileSrvc');
    const [row] = await profileMdl.getUserProfileById(user_id);
    if (!row) resutils.createError('noUser', 'User profile not found.');

    return { ...buildUserObj(row), profile_photo: row.profile_photo_url || null, date_of_birth: row.date_of_birth || null };
}

// the name a one-to-one chat starts with for the other member (conversationsMdl.createDirectConversation)
const defaultTitle = (first, last) => `${first} ${last || ''}`.trim().slice(0, 100);

/*
 * The user edits their own profile. fields holds the changed columns { first_nm?, last_nm?, mobile_no?,
 * date_of_birth? }, already checked and cleaned by profileVldtr.validateUpdate. A new name also reaches
 * the one-to-one chats where the other person still shows the old one (chats they renamed keep their
 * name), and their screens are told live.
 */
exports.updateProfileSrvc = async (user_id, fields) => {
    log('in updateProfileSrvc');
    const [before] = await profileMdl.getUserProfileById(user_id);
    if (!before) resutils.createError('noUser', 'User profile not found.');

    await profileMdl.updateProfile(user_id, fields);

    const oldName = defaultTitle(before.first_nm, before.last_nm);
    const newName = defaultTitle(fields.first_nm ?? before.first_nm, fields.last_nm !== undefined ? fields.last_nm : before.last_nm);
    if (oldName !== newName) {
        const renamed = await conversationsMdl.renameInDirectChats(user_id, oldName, newName);
        for (const { conversation_id: conversationId, user_id: memberId } of renamed) {
            appEvents.emit('conversation.updated', { userId: memberId, conversation: await conversationsService.getSummarySrvc(memberId, conversationId) });
        }
    }
    return exports.getProfileSrvc(user_id);
}
