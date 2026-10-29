const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

// records a saved file's details; the row is the source of truth for later lookups
exports.insertUploadedFileMdl = (data) => {
    log('in insertUploadedFileMdl');
    const qry = `insert into uploaded_files_lst_t
        (original_nm, stored_nm, file_path, extension, mime_type, size_bytes, checksum_sha256, entity_type, entity_id, uploaded_by)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [data.original_nm, data.stored_nm, data.file_path, data.extension, data.mime_type,
        data.size_bytes, data.checksum_sha256, data.entity_type, data.entity_id, data.uploaded_by];

    return dbutils.executeQuery(qry, params, 'insert uploaded file model');
}

// inserts the history row and repoints the user's current photo in ONE transaction:
// either both writes land or neither does — no half-updated profile
exports.insertProfilePhotoMdl = (data) => {
    log('in insertProfilePhotoMdl');
    const queries = [
        {
            query: `insert into uploaded_files_lst_t
                (original_nm, stored_nm, file_path, extension, mime_type, size_bytes, checksum_sha256, entity_type, entity_id, uploaded_by)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [data.original_nm, data.stored_nm, data.file_path, data.extension, data.mime_type,
                data.size_bytes, data.checksum_sha256, data.entity_type, data.entity_id, data.uploaded_by],
        },
        {
            query: 'update users_lst_t set profile_photo_url = ? where is_active = 1 and user_id = ?',
            params: [data.file_path, data.entity_id],
        },
    ];

    return dbutils.executeTransactionQueries(queries, 'insert profile photo transaction');
}

// a new profile photo REPLACES the old one, in ONE transaction: the new row, the user's pointer, and
// the old rows deleted. returns the old files' paths so the caller removes them from disk after the
// commit (a file is never deleted for a change that then rolls back)
exports.replaceProfilePhotoMdl = (data) => {
    log('in replaceProfilePhotoMdl');
    return dbutils.executeTransaction(async (connection) => {
        const [old] = await connection.execute(
            "select file_id, file_path from uploaded_files_lst_t where entity_type = 'USER_PROFILE' and entity_id = ? for update",
            [data.entity_id]);
        const [inserted] = await connection.execute(
            `insert into uploaded_files_lst_t
                (original_nm, stored_nm, file_path, extension, mime_type, size_bytes, checksum_sha256, entity_type, entity_id, uploaded_by)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.original_nm, data.stored_nm, data.file_path, data.extension, data.mime_type,
                data.size_bytes, data.checksum_sha256, data.entity_type, data.entity_id, data.uploaded_by]);
        await connection.execute('update users_lst_t set profile_photo_url = ? where is_active = 1 and user_id = ?', [data.file_path, data.entity_id]);
        if (old.length) {
            await connection.execute(`delete from uploaded_files_lst_t where file_id in (${old.map(() => '?').join(', ')})`, old.map((o) => o.file_id));
        }
        return { fileId: inserted.insertId, oldPaths: old.map((o) => o.file_path) };
    }, 'replace profile photo');
};

// latest active file attached to an entity (e.g. a user's current profile photo)
exports.getActiveFileByEntityMdl = (entity_type, entity_id) => {
    log('in getActiveFileByEntityMdl');
    const qry = `select file_id, original_nm, stored_nm, file_path, mime_type, size_bytes
        from uploaded_files_lst_t
        where entity_type = ? and entity_id = ? and is_active = 1
        order by file_id desc limit 1`;
    return dbutils.executeQuery(qry, [entity_type, entity_id], 'get active file by entity model');
}
