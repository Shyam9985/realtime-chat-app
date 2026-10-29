const resutils = require('../utils/response.utils');
const validutils = require('../utils/validate.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const authService = require('../services/authService');
const keysVldtr = require('../validators/keysVldtr');
const { getRequestContext } = require('../utils/request.utils');
const { verifyAccessToken, stripBearer } = require('../utils/token.utils');
const { log } = require('../utils/log.utils');

// destroys the express session bound to the request
const destroySession = (req) => {
    return new Promise((resolve, reject) => {
        req.session.destroy((err) => {
            if (err) {
                return reject(err);
            }
            resolve(true);
        });
    });
};

// maps known auth error names to standard error responses, mirroring the settings controller.
// unknown/db errors get the endpoint's friendly fallback so internals never reach the user
const sendAuthError = (req, res, error, fname, fallbackMessage) => {
    console.log('Error in ' + fname + ' : ', error);

    switch (error.name) {
        case 'validationFailed':
        case 'noEmail':
        case 'noValidEmail':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.VALIDATION_ERROR, { function: fname });

        case 'duplicateUser':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.DUPLICATE_RECORD, { function: fname });

        case 'userNotFound':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.NOT_FOUND, { function: fname });

        case 'invalidCredentials':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.INVALID_CREDENTIALS, { function: fname });

        case 'temporarlyLocked':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.TEMPORARLY_LOCKED, { function: fname });

        case 'sessionError':
        case 'destroyError':
            return resutils.sendErrorResponse(req, res, 'We could not set up your session. Please try logging in again.', RESPONSE_STATUS.SESSION_ERR, { function: fname });

        case 'noSessionId':
            return resutils.sendErrorResponse(req, res, 'You are not signed in. Please log in to continue.', RESPONSE_STATUS.INVALID_TOKEN, { function: fname });

        case 'invalidOtp':
        case 'otpExpired':
        case 'otpNotVerified':
        case 'otpMismatch':
        case 'noOtpRes':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.INVALID_OTP, { function: fname });

        case 'emailNotSent':
        case 'EmailError':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.UNABLE_TO_SEND_EMAIL, { function: fname });

        case 'noDataInserted':
        case 'updateFailed':
            return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.UNABLE_TO_PROCESS, { function: fname });

        case 'DatabaseError':
            // db level details never reach the user on auth endpoints
            return resutils.sendErrorResponse(req, res, fallbackMessage, RESPONSE_STATUS.DB_ERROR, { function: fname });

        default:
            return resutils.sendErrorResponse(req, res, fallbackMessage, RESPONSE_STATUS.UNABLE_TO_PROCESS, { function: fname });
    }
};

//Sing up controller
exports.signUp = async (req, res) => {
    log('in signUp');
    const body = req.body;

    try {

        // validate payload: the account details here, the encryption keys (body.keys) by their own validator
        const { keys: _keys, ...account } = body || {};
        const validation = await validutils.validatePayload(account,
            {
                email: { required: true, type: 'email', label: 'Email' },
                password: { required: true, type: 'password', label: 'Password' },
                mobile: { required: false, type: 'mobile-no', label: 'Mobile Number' },
                fst_nm: { required: true, type: 'alpha', minLength: 2, maxLength: 100, label: 'First Name' },
                lst_nm: { required: false, type: 'alpha', maxLength: 100, label: 'Last Name' },
                date_of_birth: { required: true, type: 'string', label: 'Date of birth', validator: (value) => validutils.isValidBirthDate(value) }
            });

        if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);
        // end-to-end encryption: the app made the keys on the phone; they are stored with the account
        const keys = keysVldtr.validateSignUpKeys(body);

        const result = await authService.signUpSrvc(body, keys);

        return resutils.sendSuccessResponse(req, res, { id: result.user_id, recovery_code_emailed: result.recovery_code_emailed }, RESPONSE_STATUS.CREATED, { function: 'signup-controller' });

    } catch (error) {
        return sendAuthError(req, res, error, 'signup controller',
            'We could not create your account right now. Please try again in a moment.');
    }
}
// login controller
exports.logIn = async (req, res) => {
    log('in logIn');
    const body = req.body;

    try {

        // validate payload
        const validation = await validutils.validatePayload(body,
            {
                email: { required: true, type: 'email', label: 'Email' },
                password: { required: true, type: 'password', label: 'Password' }
            });

        if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);

        const context = getRequestContext(req);

        // authenticate the user against the business rules
        const userRow = await authService.authenticateUserSrvc(body, context);

        // every login gets a brand-new session id
        await new Promise((resolve, reject) => {
            req.session.regenerate(err => {
                if (err) reject(err);
                else resolve();
            });
        });

        // bind the user to the express session
        const sessionId = req.sessionID;
        req.session.user_id = userRow.user_id;

        await new Promise((resolve, reject) => {
            req.session.save(err => {
                if (err) reject(err);
                else resolve();
            });
        });

        const maxAge = req.session.cookie?.originalMaxAge || 30 * 60 * 1000;
        const expiresAt = req.session.cookie?._expires || new Date(Date.now() + maxAge);

        // create session records and generate the jwt
        const sessionRes = await authService.establishSessionSrvc(userRow, sessionId, expiresAt, context);

        res.setHeader('access-token', sessionRes.token);
        // the locked key backups go only to someone who just proved the password (null: no keys yet)
        return resutils.sendSuccessResponse(req, res, { user: sessionRes.user, keys: sessionRes.keys }, RESPONSE_STATUS.DATA_FOUND, { function: 'login-controller' });

    } catch (error) {
        return sendAuthError(req, res, error, 'login controller',
            'We could not sign you in right now. Please try again in a moment.');
    }
}

exports.logOut = async (req, res) => {
    log('in logOut');
    try {

        // the browser client carries the express cookie; the mobile client only has the jwt, whose
        // session_id names the same session row. either one identifies what to log out
        const fromToken = verifyAccessToken(stripBearer(req.headers['access-token']));
        const sessionId = fromToken.payload?.session_id || req.sessionID;

        if (!sessionId) resutils.createError('noSessionId', 'No session token available');

        try {
            // destroy session
            await destroySession(req);

            // expire session in the database
            await authService.logoutSrvc(sessionId);

            return resutils.sendSuccessResponse(req, res, [{ message: 'Logged out successfully.' }], RESPONSE_STATUS.SUCCESS, { function: 'log out' });
        } catch (error) {
            resutils.createError('destroyError', 'Unable to destroy the session');
        }
    } catch (error) {
        return sendAuthError(req, res, error, 'logout controller',
            'We could not log you out cleanly. Please close the browser tab or try again.');
    }
}

exports.forgotPassword = async (req, res) => {
    log('in forgotPassword');
    const body = req.body;

    try {
        // verify req body
        if (!validutils.isValidEmail(body?.email)) resutils.createError('noEmail', 'Please provide email to proceed.');

        const result = await authService.sendForgotPasswordOtpSrvc(body.email, body?.full_name, req.user);

        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.EMAIL_SENT, { function: 'forgotEmail' });

    } catch (error) {
        return sendAuthError(req, res, error, 'forgot password controller',
            'We could not process your password reset request. Please try again in a moment.');
    }
}

exports.updatePassword = async (req, res) => {
    log('in updatePassword');
    const body = req.body;

    try {
        // validate req body (the optional re-locked key backup, body.key_backup, by its own validator)
        const { key_backup: _keyBackup, ...request } = body || {};
        const validation = await validutils.validatePayload(request, {
            email: { required: true, type: 'email', label: 'Email' },
            newPassword: { required: true, type: 'password', label: 'Password' },
            usedFor: { required: false, type: 'string', label: 'used for' },
            otpKey: { required: true, type: 'number', label: 'OTP validation key' }
        })

        if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);
        // the key backup locked again with the new password, when the phone has the key (else null)
        const keyBackup = keysVldtr.validateOptionalPasswordBackup(body.key_backup);

        const result = await authService.updatePasswordSrvc(body, keyBackup);

        return resutils.sendSuccessResponse(req, res, [{ message: 'Password updated successfully.', key_backup_updated: result.key_backup_updated }], RESPONSE_STATUS.PASSWORD_UPDATED, { function: 'update password' });

    } catch (error) {
        return sendAuthError(req, res, error, 'update password controller',
            'We could not update your password right now. Please try again in a moment.');
    }
}

exports.sendResetPasswordEmail = async (req, res) => {
    log('in sendResetPasswordEmail');
    try {
        const user = req.user;

        // verify the logged in user has a valid email
        if (!validutils.isValidEmail(user?.email)) resutils.createError('noValidEmail', 'Please provide valid email to proceed.');

        const result = await authService.sendResetPasswordOtpSrvc(user);

        return resutils.sendSuccessResponse(req, res, result, RESPONSE_STATUS.EMAIL_SENT, { function: 'reset password' });

    } catch (error) {
        return sendAuthError(req, res, error, 'reset password controller',
            'We could not send the reset email right now. Please try again in a moment.');
    }
}

exports.verifyEmailOtp = async (req, res) => {
    log('in verifyEmailOtp');
    const body = req.body;

    try {

        // validate req body
        const validation = await validutils.validatePayload(body, {
            email: { required: true, type: 'email', label: 'Email' },
            otp: { required: true, type: 'number', label: 'OTP' },
            message_key: { required: true, type: 'number', label: 'OTP validation key' }
        });

        if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);

        const result = await authService.verifyEmailOtpSrvc(body, req.user);

        return resutils.sendSuccessResponse(req, res, [{ ...result, message: 'OTP verified successfully.' }], RESPONSE_STATUS.VALID_OTP, { function: 'verify-email otp' });

    } catch (error) {
        return sendAuthError(req, res, error, 'verify email otp controller',
            'We could not verify your OTP right now. Please try again in a moment.');
    }
}
