/*
 * Request logging: every HTTP request gets a unique id and one line in a daily
 * text file, metrics/YYYY-MM-DD.log (one JSON object per line).
 *
 *   requestId     - middleware: uuid -> req.id and the 'x-request-id' response header
 *   requestLogger - middleware: writes the line AFTER the response has been sent
 *   closeMetrics  - closes the open log file, called on server shutdown
 *
 * Mount requestId then requestLogger FIRST in node.js so every request,
 * including 404s, is tagged and logged.
 *
 * Filled in by other code and picked up here:
 *   req.user             - isAuthenticated (jwt user)
 *   req.session.user_id  - express-session (set on login)
 *   res.locals.userId    - a controller can set it when neither of the above holds
 *   res.locals.statusKey - response.utils
 *   res.locals.error     - response.utils and the global error handler
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { format } = require('date-fns');
const { redact, limitSize } = require('../utils/redact.utils');
const { getClientIp, getUserAgent } = require('../utils/request.utils');

// ===================== METRICS FILE =====================

// METRICS_DIR from .env, else <project-root>/metrics. created once at startup
const METRICS_DIR = path.resolve(process.env.METRICS_DIR || path.join(__dirname, '../../metrics'));
fs.mkdirSync(METRICS_DIR, { recursive: true });

// the file for the current day stays open; it is swapped when the date changes
let openDate = null;
let openStream = null;

const getStream = () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (openDate === today) return openStream;

    if (openStream) openStream.end();

    openStream = fs.createWriteStream(path.join(METRICS_DIR, `${today}.log`), { flags: 'a' });
    openStream.on('error', (error) => console.error('[metrics] write error:', error.message));
    openDate = today;
    return openStream;
};

// appends one entry as a single JSON line. logging must never break a request,
// so a failure here is only printed
const writeLine = (entry) => {
    try {
        getStream().write(JSON.stringify(entry) + '\n');
    } catch (error) {
        console.error('[metrics] could not write log line:', error.message);
    }
};

// flushes and closes the open file
const closeMetrics = () => new Promise((resolve) => {
    if (!openStream) return resolve();
    openStream.end(resolve);
    openStream = null;
    openDate = null;
});

// ===================== MIDDLEWARES =====================

const requestId = (req, res, next) => {
    req.id = randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
};

const requestLogger = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        try {
            const body = req.body && Object.keys(req.body).length ? limitSize(redact(req.body)) : null;

            writeLine({
                ts: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"),
                requestId: req.id || null,
                userId: res.locals.userId || req.user?.user_id || req.session?.user_id || null,
                method: req.method,
                url: req.originalUrl,
                route: req.route ? req.baseUrl + req.route.path : null,
                params: req.params || {},
                query: redact(req.query || {}),
                body,
                status: res.statusCode,
                statusKey: res.locals.statusKey || null,
                durationMs: Date.now() - start,
                ip: getClientIp(req),
                userAgent: getUserAgent(req),
                error: res.locals.error || null
            });
        } catch (error) {
            console.error('[metrics] request logger failed:', error.message);
        }
    });

    next();
};

module.exports = { requestId, requestLogger, closeMetrics, METRICS_DIR };
