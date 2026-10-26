const jwt = require('jsonwebtoken');

/*
 * One place that knows how an access token is read. Used by the http auth middleware
 * (through authMdlwre) and by the socket handshake, so both accept exactly the same token.
 *
 * returns { payload } on success, or { expired: true, payload } when the signature is valid
 * but the token is past its exp, or { invalid: true } for anything else.
 */
const verifyAccessToken = (token) => {
    if (!token || typeof token !== 'string') return { invalid: true };
    try {
        return { payload: jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }) };
    } catch (error) {
        if (error.name === 'TokenExpiredError') return { expired: true, payload: jwt.decode(token) };
        return { invalid: true };
    }
};

// 'Bearer <jwt>' or a bare jwt -> jwt
const stripBearer = (value) => {
    if (!value || typeof value !== 'string') return null;
    return value.startsWith('Bearer ') ? value.slice(7).trim() : value.trim();
};

module.exports = { verifyAccessToken, stripBearer };
