const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// fetches the profile details for a logged in user by id (no credential/lock columns). the date of
// birth comes back as 'YYYY-MM-DD' text, so no time zone can move it to the day before
exports.getUserProfileById = (user_id) => {
    log('in getUserProfileById');
    const qry = `select u.user_id, u.user_nm , u.first_nm , u.last_nm, u.mobile_no, u.email, u.profile_photo_url,
        DATE_FORMAT(u.date_of_birth, '%Y-%m-%d') as date_of_birth, DATE_FORMAT(u.last_login, '%d-%m-%Y %H:%i:%s') as last_login
        from users_lst_t u
        where u.is_active = 1 and u.user_id = ?`;
    return dbutils.executeQuery(qry, [user_id], 'get user profile model');
}

// the editable part of the user's own profile; only the columns given change (the email is the login
// id and is not editable here)
const EDITABLE = ['first_nm', 'last_nm', 'mobile_no', 'date_of_birth'];
exports.updateProfile = (user_id, fields) => {
    log('in updateProfile');
    const keys = Object.keys(fields).filter((k) => EDITABLE.includes(k));
    const qry = `update users_lst_t set ${keys.map((k) => `${k} = ?`).join(', ')} where user_id = ? and is_active = 1`;
    return dbutils.executeQuery(qry, [...keys.map((k) => fields[k]), user_id], 'update profile model');
}
