/*
 * Boots the real express app + socket.io on an ephemeral port against the configured database.
 * Nothing is mocked: these are integration tests of the behaviour the SRS asks for.
 */
process.env.SCHEDULE_RUN = 'false';           // no cron jobs in the test process
process.env.RATE_LIMIT_BYPASS = 'true';       // the http limiter is per ip and every test call comes from one ip
process.env.SHOW_LOG = process.env.TEST_SHOW_LOG || 'false';
require('dotenv').config();

const http = require('http');
const { io: ioClient } = require('socket.io-client');
const dbConfig = require('../../server/config/db.config');

let serverModule;   // required lazily so the env above is in place first

const start = async () => {
    serverModule = require('../../node');
    const { initSocket } = require('../../server/socket');
    const server = http.createServer(serverModule.app);
    const io = initSocket(server, { allowedOrigins: serverModule.allowedOrigins });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return { server, io, baseUrl };
};

const stop = async ({ server, io }) => {
    const { closeMetrics } = require('../../server/middleware/requestLoggerMdlwre');
    io.close();
    await new Promise((resolve) => server.close(() => resolve()));
    await Promise.allSettled([closeMetrics(), dbConfig.pool.end(), dbConfig.userPool.end()]);
    // the session store keeps a sweep timer; nothing else should be holding the loop
    setTimeout(() => process.exit(0), 1500).unref();
};

// minimal rest client: returns { status, body, headers }
const api = (baseUrl, token) => {
    const call = async (method, path, body) => {
        const headers = { 'content-type': 'application/json', origin: 'http://localhost:8081' };
        if (token) headers['access-token'] = `Bearer ${token}`;
        const res = await fetch(`${baseUrl}/apiv1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        let json = null;
        try { json = await res.json(); } catch (_) { /* no body */ }
        return { status: res.status, body: json, headers: res.headers };
    };
    return {
        get: (path) => call('GET', path),
        post: (path, body = {}) => call('POST', path, body),
        del: (path) => call('DELETE', path)
    };
};

// registers + logs in a fresh user, returns { user, token, email, password }
const createUser = async (baseUrl, label) => {
    const email = `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${label}@test.local`;
    const password = 'Integration@123';
    const anon = api(baseUrl);
    const reg = await anon.post('/auth/signup', { email, password, fst_nm: label });
    if (reg.status !== 201) throw new Error(`signup failed: ${JSON.stringify(reg.body)}`);
    const login = await anon.post('/auth/login', { email, password });
    if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
    const token = (login.headers.get('access-token') || '').replace(/^Bearer /, '');
    return { user: login.body.data.user, token, email, password };
};

// socket connected (or rejected) as a promise
const connectSocket = (baseUrl, token) => new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 4000 });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => { socket.close(); reject(error); });
});

// resolves with the first payload of `event` that satisfies `predicate`
const waitFor = (socket, event, predicate = () => true, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timed out waiting for ${event}`)); }, timeoutMs);
    const handler = (payload) => {
        if (!predicate(payload)) return;
        clearTimeout(timer); socket.off(event, handler); resolve(payload);
    };
    socket.on(event, handler);
});

const emitWithAck = (socket, event, payload, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack) => { clearTimeout(timer); resolve(ack); });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// direct sql for setup/teardown and for the clock manipulation the delete-window test needs
const sql = (query, params = []) => dbConfig.pool.query(query, params).then(([rows]) => rows);

// removes everything the given users touched, in foreign-key order
const cleanupUsers = async (userIds) => {
    if (!userIds.length) return;
    const marks = userIds.map(() => '?').join(',');
    const convIds = (await sql(`select distinct conversation_id from conversation_members_t where user_id in (${marks})`, userIds)).map((r) => r.conversation_id);
    if (convIds.length) {
        const cm = convIds.map(() => '?').join(',');
        await sql(`update conversations_lst_t set last_message_id = null where conversation_id in (${cm})`, convIds);
        await sql(`update conversation_members_t set last_read_message_id = null where conversation_id in (${cm})`, convIds);
        await sql(`delete r from message_receipts_t r join messages_lst_t m on m.message_id = r.message_id where m.conversation_id in (${cm})`, convIds);
        await sql(`delete from messages_lst_t where conversation_id in (${cm})`, convIds);
        await sql(`delete from conversation_members_t where conversation_id in (${cm})`, convIds);
        await sql(`delete from conversations_lst_t where conversation_id in (${cm})`, convIds);
    }
    // uploaded photos: the rows reference the users, the files live under server/uploads
    const files = await sql(`select file_path from uploaded_files_lst_t where uploaded_by in (${marks})`, userIds);
    await sql(`delete from uploaded_files_lst_t where uploaded_by in (${marks})`, userIds);
    for (const f of files) await require('fs').promises.unlink(require('path').join(__dirname, '../../server', f.file_path)).catch(() => {});
    await sql(`delete from user_blocks_t where blocker_id in (${marks}) or blocked_id in (${marks})`, [...userIds, ...userIds]);
    await sql(`delete from audit_logs_t where user_id in (${marks})`, userIds);
    await sql(`delete from user_login_history_t where user_id in (${marks})`, userIds);
    await sql(`delete from user_sessions_t where user_id in (${marks})`, userIds);
    await sql(`delete from users_lst_t where user_id in (${marks})`, userIds);
    await sql(`delete from audit_logs_t where user_id is null and created_at > now() - interval 1 hour and description like '%test.local%'`);
};

module.exports = { start, stop, api, createUser, connectSocket, waitFor, emitWithAck, sleep, sql, cleanupUsers };
