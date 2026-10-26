const auditMdl = require('../models/auditMdl');
const { log } = require('../utils/log.utils');

/**********************************************
*name : audit
*description : marks a route as auditable. leaves the details on res.locals.audit; the actual
*              row is written by auditService.log() when the response goes out (response.utils).
*              for update/delete routes (an :id in the url) the current row is fetched first so
*              the audit can carry its old values.
* input : audit('USER', 'UPDATE', 'users_lst_t', 'user_id')
*         audit('USER', 'LOGIN')                       - no table: no snapshot
************************************************/
exports.audit = (entity, action, table = null, pk = null) => async (req, res, next) => {
    log(`in audit middleware: ${action} ${entity}`);

    res.locals.audit = {
        entity, action, pk,
        // noted now because some routes (logout) drop the session before responding
        userId: req.user?.user_id ?? req.session?.user_id ?? null,
        oldValues: null
    };

    // snapshot of the row about to change. a lookup failure must not block the request,
    // so it is only printed and the audit row simply goes out without old values
    if (table && pk && req.params.id) {
        try {
            const [row] = await auditMdl.getRowByIdMdl(table, pk, req.params.id);
            res.locals.audit.oldValues = row || null;
        } catch (error) {
            console.error(`[audit] could not read old values from ${table}:`, error.message);
        }
    }

    next();
};
