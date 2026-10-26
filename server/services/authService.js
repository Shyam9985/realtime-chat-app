const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const authMdl = require('../models/authMdl');
const resutils = require('../utils/response.utils');
const emailutils = require('../utils/email.utils');
const { log } = require('../utils/log.utils');

// shown in outgoing mails; set APP_NAME in .env
const APP_NAME = process.env.APP_NAME || 'Chat App';

// builds the client facing user object from a user row; the same shape is used for the
// jwt payload (login and refresh) and the profile response. credential and lock columns
// never go in here
const buildUserObj = (row) => ({
    user_id: row?.user_id,
    user_nm: row?.user_nm,
    first_nm: row?.first_nm,
    last_nm: row?.last_nm,
    mobile_no: row?.mobile_no,
    email: row?.email,
    last_login: row?.last_login
});

// builds the OTP email payload for forgot/reset password mails
const buildOtpEmailData = (email, fullName, otp, { reason, subject, heading, intro }) => ({
    reason,
    email,
    key: otp,
    subject,
    body: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2 style="color: #2c3e50;">${heading}</h2>

            <p>Hello ${fullName || 'User'},</p>
            <p>${intro}</p>
            <p>Your One-Time Password (OTP) is:</p>
            <div style="
                display: inline-block;
                padding: 12px 24px;
                font-size: 24px;
                font-weight: bold;
                letter-spacing: 4px;
                color: #ffffff;
                background-color: #007bff;
                border-radius: 6px;
                margin: 10px 0;
            ">
                ${otp}
            </div>

            <p>This OTP is valid for <strong>5 minutes</strong>. Please do not share it with anyone.</p>
            <p>If you did not request this, please ignore this email. No changes will be made to your account.</p>
            <br>
            <p>
                Regards,<br>
                <strong>Team ${APP_NAME}</strong>
            </p>

            <hr>

            <small style="color: #777;">This is an automated email. Please do not reply to this message.</small>
        </div>`
});

// sends an OTP mail and returns the message references
const sendOtpEmail = async (email, data, user) => {
    const mailRes = await emailutils.sendEmail([email], data, user);
    const mail = mailRes?.[0];

    if (!mail?.success) resutils.createError('emailNotSent', 'Unable to send email right now. please try again.');

    return { email: mail.email, message_key: mail.messageKey, message_id: mail.messageId };
}

// generates a signed jwt for the given user row and session
exports.generateJWToken = async (user, session_id) => {
    log('in generateJWToken');
    const obj = { ...buildUserObj(user), session_id };
    const token = jwt.sign(obj, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.SESSION_EXPIRES });
    return { token, obj };
}

// creates a new user with a hashed password
exports.signUpSrvc = async (payload) => {
    log('in signUpSrvc');
    const saltKey = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(payload.password, saltKey);

    try {
        const response = await authMdl.signUp({ ...payload, passwordHash, saltKey }, {});

        if (!response?.affectedRows) resutils.createError('noDataInserted', 'Unable to create user. please try again');

        return { user_id: response.insertId };

    } catch (error) {
        if (error.name === 'DatabaseError' && error.code === 'ER_DUP_ENTRY') {
            resutils.createError('duplicateUser', 'User already exists with the given email. please use different mail id');
        }
        throw error;
    }
}

// verifies credentials and lock status; records the failed attempt when the password is wrong
exports.authenticateUserSrvc = async (payload, context = {}) => {
    log('in authenticateUserSrvc');
    const userData = await authMdl.getUserDetails(payload);

    if (!userData?.length) resutils.createError('invalidCredentials', 'Invalid email/password.');

    const userRow = userData[0];

    if (userRow.is_locked) {
        resutils.createError('temporarlyLocked', `Your account is temporarily locked due to multiple failed attempts. please try after ${userRow.locked_until}`);
    }

    const isPasswordMatched = await bcrypt.compare(payload.password, userRow.password_hash);

    if (!isPasswordMatched) {
        await authMdl.increaseLoginAttempts(userRow.email);
        await authMdl.insertLoginHistory({ user_id: userRow.user_id, ip_address: context.ipAddress, device_info: context.deviceInfo, remarks: 'invalid credentials.' });
        resutils.createError('invalidCredentials', 'Invalid email or password');
    }

    return userRow;
}

// records session/login history, resets attempts and returns the jwt with the user object
exports.establishSessionSrvc = async (userRow, sessionId, expiresAt, context = {}) => {
    log('in establishSessionSrvc');
    const tokenRes = await exports.generateJWToken(userRow, sessionId);

    const sessionHistory = await authMdl.insertSessionHistory({ session_id: sessionId, user_id: userRow.user_id, expires_at: expiresAt });
    if (!sessionHistory?.affectedRows) resutils.createError('sessionError', 'unable to create/store session');

    await authMdl.unlockUser(userRow.email);
    await authMdl.insertLoginHistory({ user_id: userRow.user_id, ip_address: context.ipAddress, device_info: context.deviceInfo, remarks: 'logged in successfully.' });
    await authMdl.updateLastLoginTime(userRow.email);

    return { token: tokenRes.token, user: buildUserObj(userRow) };
}

// expires the stored session record
exports.logoutSrvc = async (sessionId) => {
    log('in logoutSrvc');
    return authMdl.expireExpressSession(sessionId);
}

// shared with profileService so both login and profile return the same shape
exports.buildUserObj = buildUserObj;

// sends the forgot password OTP mail
exports.sendForgotPasswordOtpSrvc = async (email, fullName, user = null) => {
    log('in sendForgotPasswordOtpSrvc');

    // the otp must belong to a real, active account: otherwise the mail goes to a mistyped address
    // and the final password update has no row to change
    const account = await authMdl.getUserDetails({ email });
    if (!account?.length) resutils.createError('userNotFound', 'No account found with this email address.');
    if (!fullName) fullName = [account[0].first_nm, account[0].last_nm].filter(Boolean).join(' ');

    const otp = emailutils.get6DigitOtp();

    const data = buildOtpEmailData(email, fullName, otp, {
        reason: 'forgot-password',
        subject: `Forgot Password OTP - ${APP_NAME}`,
        heading: 'Password update Request',
        intro: `We received a request to update your ${APP_NAME} account password.`
    });

    return sendOtpEmail(email, data, user);
}

// sends the reset password OTP mail for the logged in user
exports.sendResetPasswordOtpSrvc = async (user) => {
    log('in sendResetPasswordOtpSrvc');
    const otp = emailutils.get6DigitOtp();

    const data = buildOtpEmailData(user.email, user?.full_name, otp, {
        reason: 'reset-password',
        subject: `Password Reset OTP - ${APP_NAME}`,
        heading: 'Password Reset Request',
        intro: `We received a request to reset your ${APP_NAME} account password.`
    });

    return sendOtpEmail(user.email, data, user);
}

// validates the entered OTP and marks it as used
exports.verifyEmailOtpSrvc = async (payload, user) => {
    log('in verifyEmailOtpSrvc');
    const otpRes = await authMdl.getOTPData(payload, user);

    if (!otpRes?.length) resutils.createError('noOtpRes', 'OTP request not found.');

    const otpData = otpRes[0];

    if (String(otpData.verify_key) !== String(payload.otp)) resutils.createError('otpMismatch', 'Invalid OTP entered');

    if (otpData.is_expired == 1) resutils.createError('otpExpired', 'OTP has expired. Please generate new otp.');

    await authMdl.markOTPVerified(payload.message_key, user);

    return { verified: true };
}

// updates the password after checking the OTP was verified and not expired
exports.updatePasswordSrvc = async (payload) => {
    log('in updatePasswordSrvc');
    const forgotMailRes = await authMdl.getLatestMailByRequest(payload, payload?.usedFor);
    const response = forgotMailRes?.[0];

    if (!response || (response.email_audit_id != payload.otpKey)) resutils.createError('invalidOtp', 'Invalid password request');

    if (response?.is_expired) resutils.createError('otpExpired', 'OTP expired. please try again.');

    if (!response?.is_used) resutils.createError('otpNotVerified', 'OTP not verified. please verify and try again.');

    const saltKey = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(payload.newPassword, saltKey);

    const updateRes = await authMdl.updateUserPassword(payload.email, passwordHash, saltKey);

    // zero rows means the otp was issued for an email that is not an active account
    if (!updateRes?.affectedRows) resutils.createError('userNotFound', 'No active account found for this email address. Please request a new OTP with the email you registered with.');

    await authMdl.expireOtp(payload.otpKey);

    return { updated: true };
}
