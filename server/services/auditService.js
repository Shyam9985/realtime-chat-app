/*
 * Audit logging: one row in audit_logs_t per audited business action.
 *
 * A route is marked with the audit() middleware (auditMdlwre.js), which leaves
 * { entity, action, pk, userId, oldValues } on res.locals.audit. When the response
 * is sent, response.utils calls log() below. The insert is NOT awaited: a failed
 * audit insert is only printed and never affects the request.
 */

const auditMdl = require('../models/auditMdl');
const logutils = require('../utils/log.utils');
const { redact } = require('../utils/redact.utils');
const { getClientIp, getUserAgent } = require('../utils/request.utils');

const AUDIT_STATUS = { SUCCESS: 'SUCCESS', FAILED: 'FAILED' };

// /apiv1/auth -> AUTH, /apiv1/conversations -> CONVERSATIONS
const moduleFromUrl = (req) => (req.baseUrl || '').split('/').filter(Boolean).pop()?.toUpperCase() || 'APP';

// keeps text inside the column size
const cut = (text, max) => (text ? String(text).slice(0, max) : null);

/**********************************************
*name : log
*description : writes the audit row for the current request (only when the route was marked with audit())
* input : (req, res, 'SUCCESS' | 'FAILED', { message, data, error })
*         message - the response message (description)
*         data    - success payload, used to pick up a newly created record's id
*         error   - the error text sent to the client (failures only)
************************************************/
exports.log = (req, res, status, { message = null, data = null, error = null } = {}) => {
    const audit = res.locals.audit;
    if (!audit) return;
    logutils.log('in auditService.log');

    const record = {
        request_id: req.id || null,
        // req.user (jwt) or the session normally has the user; audit.userId was noted by the
        // middleware at the start of the request for cases like logout, where the session is gone by now
        user_id: req.user?.user_id ?? req.session?.user_id ?? audit.userId ?? null,
        action: `${audit.action}_${audit.entity}_${status}`,
        module: moduleFromUrl(req),
        entity_type: audit.entity,
        // update/delete carry the id in the url; create gets it from the response payload
        entity_id: cut(req.params?.id ?? data?.[audit.pk], 40),
        status,
        status_key: res.locals.statusKey || null,
        description: cut(message, 500),
        old_values: audit.oldValues ? redact(audit.oldValues) : null,
        new_values: req.body && Object.keys(req.body).length ? redact(req.body) : null,
        error_message: status === AUDIT_STATUS.FAILED ? cut(error?.message || error, 500) : null,
        ip_address: getClientIp(req),
        user_agent: getUserAgent(req)
    };

    auditMdl.insertAuditLogMdl(record)
        .catch((err) => console.error(`[audit] insert failed for request ${record.request_id}:`, err.message));
};

exports.AUDIT_STATUS = AUDIT_STATUS;
