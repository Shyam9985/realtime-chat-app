const mysql = require('mysql2/promise');
const fs = require('fs');
const { log } = require('../utils/log.utils');

const baseConfig = {
    connectionLimit: 7,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    // 0 = callers wait for a free connection instead of being refused. a burst (many sockets sending
    // at once) then costs latency, never a failed write; the rate limiters bound the burst itself
    queueLimit: 0,
    waitForConnections: true,
    ssl: {
        rejectUnauthorized: false,
        // ca: fs.readFileSync('./certs/ca.pem')

    }
};

const adminPool = mysql.createPool({
    ...baseConfig,
    user: process.env.ADMIN_USER,
    password: process.env.ADMIN_PASSWORD,
});

// day-to-day reads and writes (no ddl). pass it as the dbPool argument of the db.utils helpers
const userPool = mysql.createPool({
    ...baseConfig,
    user: process.env.CHAT_USER,
    password: process.env.CHAT_PASSWORD,
});

const logPoolEvents = function (pool) {
    log('In logPoolEvents function');
    pool.on('acquire', function (connection) {
        log('Connection %d acquired', connection.threadId);
    })

    pool.on('connection', function (connection) {
        connection.query('SET SESSION auto_increment_increment=1')
    });

    pool.on('enqueue', function () {
        log('Waiting for available connection slot');
    });

    pool.on('release', function (connection) {
        log('Connection %d released', connection.threadId);
    });
}

module.exports = { pool: adminPool, userPool, logPoolEvents, escapeValue: mysql.escape }