/*
 * Reads client details (ip, user agent, device info) off an express request.
 * One place for this logic so the request logger, audit service and login
 * history all report the same ip for the same request.
 */

const UAParser = require('ua-parser-js');

// client ip. req.ip already resolves x-forwarded-for, but ONLY when app.set('trust proxy')
// is on (node.js, production). reading the header directly instead would let any client
// send a fake x-forwarded-for and get a new rate limit bucket per request
const getClientIp = (req) =>
    req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || null;

// raw user-agent header, capped so a bogus header cannot bloat a log line
const getUserAgent = (req, maxChars = 512) => String(req.headers['user-agent'] || '').slice(0, maxChars) || null;

// ip plus a parsed, human readable device string ('<ua> | Chrome | 128.0 | Windows').
// parsing costs a little, so only login/session flows use this - the request
// logger stores the raw header via getUserAgent instead
const getRequestContext = (req) => {
    const ipAddress = getClientIp(req);

    const result = new UAParser(req.headers['user-agent']).getResult();
    const deviceInfo = [result?.ua, result.browser.name, result.browser.version, result.os.name].filter(Boolean).join(' | ');

    return { ipAddress, deviceInfo };
};

module.exports = { getClientIp, getUserAgent, getRequestContext };
