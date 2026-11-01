const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

/*
 * Files that should be gone from storage but are not yet: a delete the bucket refused (a network blip
 * after the database already committed the change). The sweep job retries them until they are gone.
 */

// one row per file (a path recorded twice stays one row, with the latest reason)
exports.recordOrphans = (paths, reason, error) => {
    log('in recordOrphans');
    // an upsert, so through executeTransaction: the query guard reads "on duplicate key update" as an
    // update without a where
    const qry = `insert into orphaned_files_t (file_path, reason, last_error) values ${paths.map(() => '(?, ?, ?)').join(', ')}
        on duplicate key update reason = values(reason), last_error = values(last_error), deleted_at = null, is_active = 1`;
    return dbutils.executeTransaction((connection) => connection.execute(qry, paths.flatMap((p) => [p, reason, error])), 'record orphaned files');
};

// the files still to delete, oldest first
exports.listPending = (limit) => {
    log('in listPending orphans');
    const qry = `select orphan_id, file_path, attempts from orphaned_files_t
        where deleted_at is null and is_active = 1 order by orphan_id limit ${Number(limit)}`;
    return dbutils.executeQuery(qry, [], 'list pending orphans');
};

exports.markDeleted = (ids) => {
    log('in markDeleted orphans');
    const qry = `update orphaned_files_t set deleted_at = now(3), attempts = attempts + 1 where orphan_id in (${ids.map(() => '?').join(', ')})`;
    return dbutils.executeQuery(qry, ids, 'mark orphans deleted');
};

exports.markFailed = (ids, error) => {
    log('in markFailed orphans');
    const qry = `update orphaned_files_t set attempts = attempts + 1, last_error = ? where orphan_id in (${ids.map(() => '?').join(', ')})`;
    return dbutils.executeQuery(qry, [error, ...ids], 'mark orphans failed');
};
