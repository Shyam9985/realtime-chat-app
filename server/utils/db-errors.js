const DB_ERRORS = {

    ER_ACCESS_DENIED_ERROR: {
        code: 1045,
        message: 'Invalid database username or password'
    },

    ER_DBACCESS_DENIED_ERROR: {
        code: 1044,
        message: 'Database access denied for current user'
    },

    ER_BAD_DB_ERROR: {
        code: 1049,
        message: 'Database does not exist'
    },

    ER_NO_SUCH_TABLE: {
        code: 1146,
        message: 'Requested table does not exist'
    },

    ER_BAD_FIELD_ERROR: {
        code: 1054,
        message: 'Requested column does not exist'
    },

    ER_DUP_ENTRY: {
        code: 1062,
        message: 'Record already exists with the same details'
    },

    ER_LOCK_DEADLOCK: {
        code: 1213,
        message: 'Transaction deadlock detected'
    },

    ECONNREFUSED: {
        code: 5050,
        message: 'Database server is unavailable'
    },

    ETIMEDOUT: {
        code: 4040,
        message: 'Database connection timed out'
    },

    ENOTFOUND: {
        code: 3030,
        message: 'Database host could not be resolved'
    },

    HANDSHAKE_SSL_ERROR: {
        code: 2020,
        message: 'SSL handshake failed'
    },

    UNKNOWN_DATABASE_ERROR: {
        code: 1010,
        message: 'Unknown database error occurred'
    },
    
    // =========================
    // Authorization & Privileges
    // =========================

    ER_TABLEACCESS_DENIED_ERROR: {
        code: 1142,
        message: 'Access denied for requested table operation'
    },

    ER_COLUMNACCESS_DENIED_ERROR: {
        code: 1143,
        message: 'Access denied for requested column operation'
    },

    ER_PROCACCESS_DENIED_ERROR: {
        code: 1370,
        message: 'Access denied for stored procedure operation'
    },

    ER_SPECIFIC_ACCESS_DENIED_ERROR: {
        code: 1227,
        message: 'Insufficient privileges to perform requested operation'
    },

    ER_KILL_DENIED_ERROR: {
        code: 1095,
        message: 'Permission denied to terminate database process'
    },

    ER_DBACCESS_DENIED_ERROR: {
        code: 1044,
        message: 'Access denied for database'
    },

    ER_ACCESS_DENIED_ERROR: {
        code: 1045,
        message: 'Invalid database username or password'
    },

    ER_NO_DEFAULT_FOR_FIELD: {
        code: 1045,
        message: 'Requested field(s) does not support null values'
    },

    ER_WRONG_VALUE_COUNT_ON_ROW: {
        code: 1045,
        message: 'Column count does not match value count in query'
    },
};

exports.getDatabaseError = (errorCode) => {

    return (
        DB_ERRORS[errorCode] ||
        DB_ERRORS.UNKNOWN_DATABASE_ERROR
    );

};

