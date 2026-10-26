const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// table/column names only ever come from our own route code, but they are placed into
// the sql as text (mysql2 cannot bind identifiers), so make sure they look like identifiers
const isIdentifier = (name) => /^[a-z_][a-z0-9_]*$/i.test(name);

// inserts one audit row. old/new values are objects and are stored as json text
exports.insertAuditLogMdl = (record) => {
    log('in insertAuditLogMdl');
    const qry = `insert into audit_logs_t
        (request_id, user_id, action, module, entity_type, entity_id, status, status_key,
         description, old_values, new_values, error_message, ip_address, user_agent)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    return dbutils.executeQuery(qry, [
        record.request_id, record.user_id, record.action, record.module, record.entity_type, record.entity_id,
        record.status, record.status_key, record.description,
        record.old_values ? JSON.stringify(record.old_values) : null,
        record.new_values ? JSON.stringify(record.new_values) : null,
        record.error_message, record.ip_address, record.user_agent
    ], 'insert audit log model');
}

// fetches one row by primary key - the "old values" snapshot taken before an update/delete
exports.getRowByIdMdl = (table, pk, id) => {
    log('in getRowByIdMdl');
    if (!isIdentifier(table) || !isIdentifier(pk)) throw new Error(`invalid audit table/pk: ${table}.${pk}`);

    const qry = `select * from \`${table}\` where \`${pk}\` = ?`;
    return dbutils.executeQuery(qry, [id], 'get row by id model');
}
