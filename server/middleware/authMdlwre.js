const jwt = require('jsonwebtoken');
const resutils = require("../utils/response.utils");
const RESPONSE_STATUS = require("../utils/standard.messages");
const authService = require('../services/authService');
const { logBlock } = require('../utils/log.utils');

// authntication validation middleware
exports.isAuthenticated = async (req, res, next) => {
    let token = req.headers['access-token'];
    let user = null
    logBlock('[is authenticated] token:', token);

    try {
        // retrieve the access token form the headers 
        if (!token || !token.startsWith('Bearer')) {
            resutils.createError('unauthorizedToken', 'Please provide valid token.');
        }
        token = token.split(' ')[1];

        let decodedToken = null;

        try {
            // check if token expires 
            decodedToken = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

            // a valid signature is not enough: logout and the session lifetime are enforced on
            // the stored session, otherwise a stolen or logged-out token would work until it expires
            const session = await authService.getSessionSrvc(decodedToken.session_id);
            if (!session?.length || session[0].destroyed_at != null || session[0].is_expired) resutils.createError('sessionExpired', 'Your session has expired. Please log in again.');
            if (session[0].is_locked) resutils.createError('TemporarilyLocked', `Your account is temporarily locked. Please try again after ${session[0].locked_until}.`);

            user = decodedToken;
            // console.log('JWT Token is still alive...', token);

        } catch (error) {
            if (error.name === 'TokenExpiredError') {

                const decoded = jwt.decode(token);
                logBlock('[is authenticated] token expired, checking session - decoded token:', decoded);
                const sessionId = decoded?.session_id;

                if (!sessionId) resutils.createError('sessionExpired', 'Your session has expired. Please log in again.');

                // check if session is still alive or not
                const isAlive = await authService.getSessionSrvc(sessionId);

                // expired throw error
                if (!isAlive || !isAlive?.length || isAlive?.[0]?.destroyed_at != null) resutils.createError('sessionExpired', 'Your session has expired. Please log in again.');

                if (isAlive && isAlive?.[0]?.is_expired) resutils.createError('sessionExpired', 'Your session has expired. Please log in again.');

                if (isAlive?.[0]?.is_locked) resutils.createError('TemporarilyLocked', `Your account is temporarily locked. Please try again after ${isAlive?.[0]?.locked_until}.`);

                // console.log('Session still alive but jwt token has expired.');

                const userData = await authService.getUserByEmailSrvc(decoded?.email);

                // alive - regenereate token and sent it to the client

                // fetch user data
                if (!userData?.length) resutils.createError('userNotFound', 'We could not find your account. Please log in again.');

                const userObj = userData?.[0];

                const newToken = await authService.generateJWToken(userObj, sessionId);

                // update the express session time 
                const updated = await authService.slideSessionSrvc(sessionId);
                // console.log('session successfully slided', updated);

                user = newToken.obj;
                res.setHeader('new-access-token', newToken.token);
            }
            else throw error;
        }

        // bind user data to the request 
        req.user = user;

        // deligate to the next middleware 
        next();

    } catch (error) {
        console.log('Error in auth middleware: ', error?.message || error);
        switch (error.name) {
            case 'TokenExpiredError':
                resutils.sendErrorResponse(req, res, 'Your session token has expired. Please log in again.', RESPONSE_STATUS.TOKEN_EXPIRED, { function: 'is authenticated middleware' });
                break;

            case 'JsonWebTokenError':
                resutils.sendErrorResponse(req, res, 'Your session token is invalid. Please log in again.', RESPONSE_STATUS.INVALID_TOKEN, { function: 'is authenticated middleware' });
                break;

            case 'TemporarilyLocked':
                resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.TEMPORARLY_LOCKED, { function: 'is authenticated middleware' });
                break;

            case 'userNotFound':
                resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.INVALID_CREDENTIALS, { function: 'is authenticated middleware' });
                break;

            case 'invalidToken':
                resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.SESSION_ERR, { function: 'is authenticated middleware' });
                break;

            case 'sessionExpired':
                resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.SESSION_EXPIRED, { function: 'is authenticated middleware' });
                break;

            case 'unauthorizedToken':
                resutils.sendErrorResponse(req, res, 'You are not signed in. Please log in to continue.', RESPONSE_STATUS.INVALID_TOKEN, { function: 'is authenticated middleware' });
                break;

            case 'DatabaseError':
                // session lookups can fail without the token being at fault - do not blame the user
                resutils.sendErrorResponse(req, res, 'We could not verify your session right now. Please try again in a moment.', RESPONSE_STATUS.SESSION_ERR, { function: 'is authenticated middleware' });
                break;

            default:
                resutils.sendErrorResponse(req, res, 'We could not verify your sign-in right now. Please log in and try again.', RESPONSE_STATUS.INVALID_TOKEN, { function: 'is authenticated middleware' });
                break;
        }
    }
}

