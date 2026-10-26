const dbconfig = require('../config/db.config');
const dberrors = require('./db-errors')
const { log, logBlock } = require('./log.utils');
const pool = dbconfig.pool;
dbconfig.logPoolEvents(pool);

const createError = (name, message) => {
    const err = new Error(message);
    err.name = name;
    throw err;
};

const dangerousKeywords = ['create', 'alter', 'drop', 'truncate', 'rename', 'grant', 'revoke', 'commit', 'rollback', 
    'start transaction', 'begin', 'savepoint', 'release savepoint', 'load data', 'load xml', 'shutdown','flush', 'reset', 'kill'];

/**************************************************************************************************************
 * databse validation utility functions for validating queries and executing queries with proper error handling
 * ************************************************************************************************************/

//check if query is string and not empty , values is array
function performBasicValidations(query, values) {
    if (typeof query !== 'string' || query.trim() === '') {
        logBlock('Invalid query:', query);
        throw createError('InvalidQuery', 'Invalid query: Query must be a non-empty string.');
    }
    if (!Array.isArray(values)) {
        logBlock('Invalid values:', values);
        throw createError('InvalidValues', 'Invalid values: Values must be an array.');
    }

    // check if values array contains only valid types (string, number, boolean, null)
    for (const value of values) {
        if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'object') {
            logBlock('Invalid value type:', value);
            throw createError('InvalidValueType', `Invalid value type: ${typeof value}. Values must be string, number, boolean, object, or null.`);
        }
    }

    //check if query contains any dangerous keywords
     dangerousKeywords.forEach((key) => {
        if(new RegExp(`\\b${key}\\b`, 'i').test(query.toLocaleLowerCase())) {
            logBlock('Dangerous keyword detected in query:', query);
            throw createError('DangerousKeyword', `Dangerous keyword detected in query: ${key}`);
        }
    });
}

// check if the query has only one statement
function checkIfQueryHasSingleStatement(query) {
    const semicolonCount = (query.match(/;/g) || []).length;
    if (semicolonCount > 1) {
        throw createError('MultipleStatements', 'Invalid query: Only one statement is allowed per query.');
    }
}

// check dml query has where clause
function checkIfDmlHasWhereClause(query) {
    const dmlKeywords = ['update', 'delete'];
    const lowerCaseQuery = query.toLowerCase();

    const dmlKeyword = dmlKeywords.find(keyword => new RegExp(`\\b${keyword}\\b`).test(lowerCaseQuery));

    if (!dmlKeyword) return;

    // Find the index of the DML keyword and the WHERE clause in the query
    const dmlKeywordIndex = lowerCaseQuery.search(new RegExp(`\\b${dmlKeyword}\\b`));
    const whereClauseIndex = lowerCaseQuery.indexOf('where', dmlKeywordIndex);

    // If the WHERE clause is not found or appears before the DML keyword, throw an error
    if (whereClauseIndex === -1) throw createError('MissingWhereClause', 'Invalid query: DML statements must have a WHERE clause.');
    if(whereClauseIndex < dmlKeywordIndex) throw createError('MissingWhereClause', 'Invalid query: DML statements must have a WHERE clause.');
}

// Validate query and values before executing
function validateQueryAndValues(query, values) {
    // logBlock('in validateQueryAndValues');
    performBasicValidations(query, values);
    checkIfQueryHasSingleStatement(query);
    checkIfDmlHasWhereClause(query);
}

const getConnection = async (dbPool = pool) => {
    return await dbPool.getConnection();
};

// converts a raw mysql error into a typed 'DatabaseError' carrying the friendly message
const formatDbError = (error) => {
    console.error('Database Error:', error);
    const dbError = dberrors.getDatabaseError(error.code);
    // built by hand: the local createError() throws, which used to drop the code before it was attached
    const formattedError = new Error(dbError.message);
    formattedError.name = 'DatabaseError';
    formattedError.code = error.code;
    formattedError.errno = error.errno;
    return formattedError;
}

/**********************************************
*name : executeQuery
*description : executes multiple queries
* input : ('SELECT * FROM dymmy where id = ?', [2], 'server', dbconfig.userPool) - pool is optional, defaults to admin pool
************************************************/
const executeQuery = async (query, params = [], fname, dbPool = pool) => {
    log('in executeQuery and quries received from ' + fname);

    // SHOW_LOG=true prints every model's SQL and bound parameters under a styled heading
    logBlock(`[${fname}] query:`, query.replace(/\s+/g, ' ').trim(), '| params:', params);

    try {
        validateQueryAndValues(query, params);
        const [rows] = await dbPool.execute(query, params);
        return rows;
    } catch (error) {
        throw formatDbError(error);
    } finally {
        log('Execution completed!');
    }
};

/**********************************************
*name : executeMultipleQueries
*description : executes multiple queries
* input : ('server', [{ query: 'SELECT * FROM dymmy where id = ?', params: [2] }, { query: 'SELECT * FROM dymmy where id = ?', params: [1] }])
************************************************/
const executeMultipleQueries = async (queries = [], fname, dbPool = pool) => {
    log('in executeMultipleQueries and quries received from ' + fname);

    try {
        // validate the inut queries array
        if (!Array.isArray(queries) || queries.length === 0) {
            throw createError('InvalidInput', 'Invalid input: Queries must be a non-empty array.');
        }

        // validate the queries array
        for (const queryObj of queries) {
            validateQueryAndValues(queryObj.query, queryObj.params || []);
        }

        const results = [];
        for (const query of queries) {
            logBlock(`[${fname}] query:`, query.query.replace(/\s+/g, ' ').trim(), '| params:', query.params || []);
            const [rows] = await dbPool.execute(query.query, query.params || []);
            results.push(rows);

        }
        logBlock(`[${fname}] results:`, results);

        return results;
    } catch (error) {
        throw formatDbError(error);
    }
};

/**********************************************
*name : executeTransaction
*description : executes multiple queries
* input : ('server', async (connection) => {await connection.execute(`INSERT INTO users_lst_t (user_name) VALUES(?)`,['Syam']); await connection.execute(`INSERT INTO audit_logs_t(activity) VALUES(?)`,['User Created']);});)
************************************************/
const executeTransaction = async (callback, fname, dbPool = pool) => {
    log('in executeTransaction and quries received from ' + fname);

    let connection = null;

    try {
        // get a connection from the pool and start a transaction
        connection = await dbPool.getConnection();
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;

    } catch (error) {
        connection && await connection.rollback();
        throw formatDbError(error);
    } finally {
        connection && connection.release();
    }
};

/**********************************************
*name : executeTransactionQueries
*description : executes multiple queries in a transaction
* input : ('server', [{ query: 'insert into dymmy (dumy_name) values (?)', params: ['Shyam'] }, { query: 'insert into dymmy (dumy_name) values (?)', params: ['Prasad'] }])
************************************************/
const executeTransactionQueries = async (queries = [], fname, dbPool = pool) => {
    log('in executeTransactionQueries and quries received from ' + fname);

    let connection = null;

    try {
        // validate the queries array
        for (const queryObj of queries) {
            validateQueryAndValues(queryObj.query, queryObj.params || []);
        }
        // get a connection from the pool and start a transaction
        connection = await dbPool.getConnection();
        await connection.beginTransaction();
        const results = [];
        for (const query of queries) {
            logBlock(`[${fname}] query:`, query.query.replace(/\s+/g, ' ').trim(), '| params:', query.params || []);
            const [rows] = await connection.execute(query.query, query.params || []);
            results.push(rows);
        }
        await connection.commit();
        return results;
    } catch (error) {
        connection && await connection.rollback();
        throw formatDbError(error);
    } finally {
        connection && connection.release();
    }
};

module.exports = { executeQuery, executeTransaction, executeTransactionQueries, executeMultipleQueries, getConnection, validateQueryAndValues };
