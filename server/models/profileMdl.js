const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// fetches the profile details for a logged in user by id (no credential/lock columns)
exports.getUserProfileById = (user_id) => {
    log('in getUserProfileById');
    const qry = `select u.user_id, u.user_nm , u.first_nm , u.last_nm, u.mobile_no, u.email, u.profile_photo_url, DATE_FORMAT(u.last_login, '%d-%m-%Y %H:%i:%s') as last_login
        from users_lst_t u
        where u.is_active = 1 and u.user_id = ?`;
    return dbutils.executeQuery(qry, [user_id], 'get user profile model');
}
