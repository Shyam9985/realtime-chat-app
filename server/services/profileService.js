const profileMdl = require('../models/profileMdl');
const resutils = require('../utils/response.utils');
const { buildUserObj } = require('./authService');
const { log } = require('../utils/log.utils');

// returns a fresh profile for the logged in user, shaped exactly like the login payload.
// users_lst_t.profile_photo_url points at the current photo; uploaded_files_lst_t is history
exports.getProfileSrvc = async (user_id) => {
    log('in getProfileSrvc');
    const [row] = await profileMdl.getUserProfileById(user_id);
    if (!row) resutils.createError('noUser', 'User profile not found.');

    return { ...buildUserObj(row), profile_photo: row.profile_photo_url || null };
}
