const authService = require('../services/authService');
const usersService = require('../services/usersService');
const { verifyAccessToken, stripBearer } = require('../utils/token.utils');
const { logBlock } = require('../utils/log.utils');

/*
 * FR-002 / FR-026: the handshake must carry the same jwt the rest api uses
 * (socket.handshake.auth.token, or an access-token header). the connection is refused when the
 * token is missing, invalid or expired, when the session behind it was logged out, or when the
 * account is inactive (FR-025). an expired token is reported as TOKEN_EXPIRED so the client can
 * refresh it over rest (the middleware there issues a new one) and reconnect.
 */
const reject = (statusKey, message) => {
    const error = new Error(message);
    error.data = { statusKey, message };
    return error;
};

const socketAuth = async (socket, next) => {
    const raw = socket.handshake.auth?.token || socket.handshake.headers?.['access-token'];
    const token = stripBearer(raw);
    logBlock('[socket auth] handshake from:', socket.handshake.address);

    if (!token) return next(reject('INVALID_TOKEN', 'You are not signed in.'));

    const verified = verifyAccessToken(token);
    if (verified.expired) return next(reject('TOKEN_EXPIRED', 'Your session token has expired.'));
    if (verified.invalid || !verified.payload?.user_id) return next(reject('INVALID_TOKEN', 'Your session token is invalid.'));

    try {
        // account first: the session lookup only joins active users, so an inactive account would
        // otherwise be reported as an expired session
        if (!(await usersService.isActiveUserSrvc(verified.payload.user_id))) return next(reject('ACCOUNT_INACTIVE', 'This account is inactive.'));

        const session = await authService.getSessionSrvc(verified.payload.session_id);
        if (!session.length || session[0].destroyed_at || session[0].is_expired) return next(reject('SESSION_EXPIRED', 'Your session has expired.'));
        if (session[0].is_locked) return next(reject('TEMPORARLY_LOCKED', 'Your account is temporarily locked.'));

        socket.data.user = { user_id: Number(verified.payload.user_id), session_id: verified.payload.session_id };
        return next();
    } catch (error) {
        console.error('[socket auth] lookup failed:', error.message);
        return next(reject('SESSION_ERR', 'We could not verify your session right now.'));
    }
};

module.exports = { socketAuth };
