const dbutils = require('../utils/db.utils');
const { displayDateTime } = require('../utils/date.utils');
const { log, logBlock } = require('../utils/log.utils');

// sign up controller
exports.signUp = async (data, user) => {
    log('in signUp');

    // only the hash and salt are stored, never the password itself
    const qry = 'insert into users_lst_t (user_nm , first_nm , last_nm, mobile_no, date_of_birth, email, password_hash, password_salt)values(?,?,?,?,?,?,?,?)';

    return dbutils.executeQuery(qry, [data.email, data.fst_nm, data.lst_nm || null, data.mobile || null, data.date_of_birth.trim(), data.email, data.passwordHash, data.saltKey], 'sign-up');
}

// retrieves the user data
exports.getUserDetails = async (data, user) => {
    log('in getUserDetails');
    // the user row with its credential and lock columns; user_nm holds the email
    const qry = `select u.user_id, u.user_nm , u.first_nm , u.last_nm, u.mobile_no, u.email, DATE_FORMAT(u.last_login, '%d-%m-%Y %H:%i:%s') as last_login,
        u.is_locked, u.login_attempts, u.password_hash, u.password_salt, DATE_FORMAT(u.locked_until, '%d-%m-%Y %H:%i:%s') as locked_until
        from users_lst_t u
        where u.is_active = 1 and u.user_nm = ?`;
    return dbutils.executeQuery(qry, [data.email], 'login');
}

// increases login attempts
exports.increaseLoginAttempts = (email) => {
    log('in increaseLoginAttempts');
    log('in incease login attempts model');

    const qry = `update users_lst_t set login_attempts = ifnull(login_attempts, 0) + 1, is_locked = case when login_attempts > 4 then 1 else 0 end,
    locked_until = case when login_attempts > 4 then date_add(current_timestamp(),INTERVAL 1 day) else null end  
    where user_nm = ?`;
    return dbutils.executeQuery(qry, [email], 'increaseLoginAttempts');

}

// reset login attempts
exports.unlockUser = (email) => {
    log('in unlockUser');
    log('in unlockUser model');
    const qry = `update users_lst_t set login_attempts = 0, is_locked = 0, locked_until = null where user_nm = ?`;
    return dbutils.executeQuery(qry, [email], 'unlockUser');
}

//logs email response 
exports.logEMail = async (data, user) => {
    log('in logEMail');
    const qry = `INSERT INTO email_audit_logs_t(recipient_email,email_subject,email_body,email_status, message_id,response_data, expires_at,verify_key, create_user, used_for) 
    VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), ?, ?, ?)`;
    return dbutils.executeQuery(qry, [data.to, data.subject, data.body, data.status, data.messageId, JSON.stringify(data.response), data.key, user?.user_id || null, data.reason], 'logEMail');
}

// get OTP details
exports.getOTPData = async (data, user) => {
    log('in getOTPData');
    const qry = `select recipient_email , verify_key , email_status, expires_at, ifnull(expires_at <= CURRENT_TIMESTAMP(), 1) as is_expired, create_user
    from email_audit_logs_t where is_active = 1 and is_used is null and email_status = 'SUCCESS' and email_audit_id = ? and recipient_email = ? ;`
    return dbutils.executeQuery(qry, [data.message_key, data?.email], 'getOTPData')
}

// Mark otp as used 
exports.markOTPVerified = async (key, user) => {
    log('in markOTPVerified');
    const qry = 'update email_audit_logs_t set is_used = 1 , used_by = ? where is_active = 1 and email_audit_id = ?';
    dbutils.executeQuery(qry, [user?.user_id || null, key])

}

// gets latest mail audit by mail and used for
exports.getLatestMailByRequest = async (body, usedFor = 'forgot-password') => {
    log('in getLatestMailByRequest');
    const qry = `select email_audit_id, recipient_email, verify_key, email_status, DATE_FORMAT(expires_at, '%d-%m-%Y %H:%i:%s') as expires_at, ifnull(expires_at <= CURRENT_TIMESTAMP(), 1) as is_expired, is_used
         from email_audit_logs_t where is_active = 1 and email_status = 'SUCCESS' and recipient_email = ? and used_for = ? order by email_audit_id desc limit 1;`
    return dbutils.executeQuery(qry, [body.email, usedFor], 'get latest mail request');
}

// update password by email
exports.updateUserPassword = async (email, pwdhash, salt) => {
    log('in updateUserPassword');
    const qry = 'update users_lst_t set password_hash = ?, password_salt = ?, is_locked = 0, login_attempts = 0, locked_until = null where is_active = 1 and user_nm = ?';
    return dbutils.executeQuery(qry, [pwdhash, salt, email], 'update password');
}
// update last login time by email
exports.updateLastLoginTime = async (email) => {
    log('in updateLastLoginTime');
    const qry = 'update users_lst_t set last_login = current_timestamp() where is_active = 1 and email = ?';
    return dbutils.executeQuery(qry, [email], 'update last login time');
}

//expires OTP
exports.expireOtp = async (id) => {
    log('in expireOtp');
    const qry = 'update email_audit_logs_t set expires_at = current_timestamp() where email_audit_id = ?';
    return dbutils.executeQuery(qry, [id], 'expire otp');
}

// insert sesson history details (concurrent)
exports.insertSessionHistory = async (data) => {
    log('in insertSessionHistory');
    const qry = `insert into user_sessions_t (session_id, user_id, login_timestamp, last_activity_timestamp, expires_at, is_active, created_at) 
            values (?, ? ,current_timestamp(), current_timestamp(),? ,1, current_timestamp())`;
    return dbutils.executeQuery(qry, [data.session_id, data.user_id, data.expires_at], 'insert session history');
}

// insert login history details 
exports.insertLoginHistory = async (data) => {
    log('in insertLoginHistory');
    const qry = `insert into user_login_history_t(user_id, login_timestamp, ip_address, device_info, is_active, created_at, remarks)
            values (?, current_timestamp(), ?, ?, 1, current_timestamp(), ?)`;
    return dbutils.executeQuery(qry, [data.user_id, data.ip_address, data.device_info, data.remarks], 'insert login history');
}

// checks if user has acive sesssionor not 
exports.checkIfSessionAlive = async (sessionId) => {
    log('in checkIfSessionAlive');

    const qry = `select id, session_id, u.user_id, login_timestamp, last_activity_timestamp, expires_at, destroyed_at, user_nm , first_nm , last_nm, mobile_no, 
            email, last_login, is_locked, login_attempts, DATE_FORMAT(locked_until, '%d-%m-%Y %H:%i:%s') as locked_until, 
            ifnull(expires_at <= CURRENT_TIMESTAMP(), 1) as is_expired
            from user_sessions_t as u
            join users_lst_t as ul on u.user_id = ul.user_id and ul.is_active = 1
            where u.is_active = 1 and session_id = ?;`
    // console.log(qry, sessionId)
    return dbutils.executeQuery(qry, [sessionId], 'session alive ');
}

// expire express session 
exports.expireExpressSession = (sessionId) => {
    log('in expireExpressSession');
    const qry = 'update user_sessions_t set destroyed_at = current_timestamp(), expires_at = current_timestamp() where is_active = 1 and session_id = ? ';
    return dbutils.executeQuery(qry, [sessionId], 'expire express session');
}
// slide the express session time 
// a session lives EXPRESS_SESSION_EXPIRES milliseconds after its last renewal (30 minutes if unset),
// the same lifetime the login gives it
const sessionSeconds = () => Math.round((Number(process.env.EXPRESS_SESSION_EXPIRES) || 1800000) / 1000);

exports.slideExpressSession = (sessionId) => {
    log('in slideExpressSession');
    const qry = 'update user_sessions_t set expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) where is_active = 1 and session_id = ? ';
    return dbutils.executeQuery(qry, [sessionSeconds(), sessionId], 'slide express session');
}

// unlock locked users
exports.unlockUsers = () => {
    log('in unlockUsers');
    logBlock('[unlock users] unlocking the users at:', displayDateTime(new Date()));
    const query = 'update users_lst_t set is_locked = 0 , login_attempts = 0 , locked_until = null where is_active = 1 and locked_until < current_timestamp();';
    return dbutils.executeQuery(query, [], 'unlock users');
}