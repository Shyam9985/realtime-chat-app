/*
 * Boots the real express app + socket.io on an ephemeral port against the configured database.
 * Nothing is mocked: these are integration tests of the behaviour the SRS asks for.
 */
process.env.SCHEDULE_RUN = 'false';           // no cron jobs in the test process
process.env.SHOW_LOG = process.env.TEST_SHOW_LOG || 'false';
process.env.EMAIL_SEND_DISABLED = 'true';      // sign-ups mail a recovery code: never to the fake test addresses
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

// direct sql for setup/teardown and for the clock manipulation the delete-window test needs
const sql = (query, params = []) => dbConfig.pool.query(query, params).then(([rows]) => rows);

/*
 * The phone's part of end-to-end encryption, faked for the tests. The server cannot read message text,
 * so it never checks real cryptography: it stores base64 and checks key versions. These helpers play
 * the app: text going out is "encrypted" (base64 of 'enc:' + text) with the chat's current key version
 * (making a new version first when the chat has none or one is due, as the app does), and text coming
 * back is "decrypted", so the tests keep reading plain text. The real cryptography is the app's.
 */
const fakeBase64 = (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) % 256)).toString('base64');
const fakeKeySet = () => ({
    public_key: fakeBase64(32), pw_locked_private_key: fakeBase64(72), pw_kdf_salt: fakeBase64(16), pw_kdf_params: 'n=16384,r=8,p=1',
    rc_locked_private_key: fakeBase64(72), rc_kdf_salt: fakeBase64(16), recovery_code: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX'
});
const encryptText = (text) => Buffer.from(`enc:${text}`, 'utf8').toString('base64');
const decryptText = (content) => {
    const plain = Buffer.from(content, 'base64').toString('utf8');
    return plain.startsWith('enc:') ? plain.slice(4) : content;
};

// every { content, enc_format: 1 } in an answer (messages, replies, previews, versions, scheduled) back to text
const decryptDeep = (value) => {
    if (Array.isArray(value)) return value.map(decryptDeep);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decryptDeep(v);
    if (out.enc_format === 1 && typeof out.content === 'string' && out.content) out.content = decryptText(out.content);
    return out;
};

/*
 * The rate limits stay on in the tests. Requests without a sign-in (sign-up, login, password recovery)
 * are limited per ip, and every test runs on one machine: like separate phones, each such request
 * comes from its own loopback address (127.0.0.2, .3, ...; the whole 127/8 range is this machine).
 * Signed-in requests are limited per user, so they need nothing special.
 */
let nextLoopback = 1;
const loopbackAddress = () => {
    nextLoopback = nextLoopback >= 250 * 250 ? 2 : nextLoopback + 1;
    return `127.0.${Math.floor(nextLoopback / 250)}.${(nextLoopback % 250) + 2}`;
};

// fromAddress: a fixed source address, for tests about one network (default: the next loopback address)
const anonymousCall = (baseUrl, method, path, body, fromAddress = loopbackAddress(), extraHeaders = {}) => new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/apiv1${path}`);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
        host: url.hostname, port: url.port, path: url.pathname + url.search, method, localAddress: fromAddress,
        headers: { 'content-type': 'application/json', ...extraHeaders, ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
            let json = null;
            try { json = JSON.parse(text); } catch (_) { /* no body */ }
            resolve({ status: res.statusCode, body: json, headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null } });
        });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
});

const rawCall = async (baseUrl, token, method, path, body) => {
    if (!token) return anonymousCall(baseUrl, method, path, body);
    const headers = { 'content-type': 'application/json', 'access-token': `Bearer ${token}` };
    const res = await fetch(`${baseUrl}/apiv1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch (_) { /* no body */ }
    return { status: res.status, body: json, headers: res.headers };
};

// the chat's current key version as a member's app would have it: made (with fake locked copies for the
// members who have keys) when there is none yet or a new one is due. a non-member gets the stored value
const ensureKey = async (baseUrl, token, conversationId) => {
    const [conv] = await sql('select current_key_version, needs_new_key from conversations_lst_t where conversation_id = ?', [conversationId]);
    if (!conv) return 1;
    if (conv.current_key_version && !conv.needs_new_key) return conv.current_key_version;
    const members = await sql(
        `select m.user_id, k.key_version from conversation_members_t m join user_keys_t k on k.user_id = m.user_id and k.is_active = 1
            where m.conversation_id = ? and m.is_active = 1 and m.left_at is null`, [conversationId]);
    const keyVersion = conv.current_key_version + 1;
    const res = await rawCall(baseUrl, token, 'POST', `/conversations/${conversationId}/keys`, {
        key_version: keyVersion, copies: members.map((m) => ({ user_id: m.user_id, user_key_version: m.key_version, locked_key: fakeBase64(104) }))
    });
    if (res.status === 201) return keyVersion;
    const [again] = await sql('select current_key_version from conversations_lst_t where conversation_id = ?', [conversationId]);
    return again?.current_key_version || keyVersion;
};

// the text as the app sends it: trimmed and encrypted with the current key. blank text, which the app
// refuses before encrypting, is passed on as it is, so the server's own refusal is still tested
const encryptFor = async (baseUrl, token, conversationId, content) => {
    if (typeof content !== 'string' || !content.trim()) return { content };
    return { content: encryptText(content.trim()), key_version: await ensureKey(baseUrl, token, conversationId) };
};

const MESSAGE_PATH = /^\/messages\/(\d+)$/;
const SCHEDULE_PATH = /^\/conversations\/(\d+)\/scheduled$/;
const SCHEDULED_PATH = /^\/scheduled\/(\d+)$/;
const FORWARD_PATH = /^\/messages\/(\d+)\/forward$/;

// the outgoing body of the routes that carry message text, encrypted as the app would
const encryptBody = async (baseUrl, token, method, path, body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    let m;
    if (method === 'POST' && path === '/messages' && 'content' in body) {
        return { ...body, ...(await encryptFor(baseUrl, token, body.conversation_id, body.content)) };
    }
    if (method === 'PATCH' && (m = path.match(MESSAGE_PATH)) && 'content' in body) {
        const [row] = await sql('select conversation_id from messages_lst_t where message_id = ?', [m[1]]);
        return { ...body, ...(await encryptFor(baseUrl, token, row?.conversation_id, body.content)) };
    }
    if (method === 'POST' && (m = path.match(SCHEDULE_PATH)) && 'content' in body) {
        return { ...body, ...(await encryptFor(baseUrl, token, Number(m[1]), body.content)) };
    }
    if (method === 'PATCH' && (m = path.match(SCHEDULED_PATH)) && 'content' in body) {
        const [row] = await sql('select conversation_id from scheduled_messages_t where scheduled_message_id = ?', [m[1]]);
        return { ...body, ...(await encryptFor(baseUrl, token, row?.conversation_id, body.content)) };
    }
    if (method === 'POST' && (m = path.match(FORWARD_PATH)) && Array.isArray(body.conversation_ids)) {
        // the app decrypts the source and encrypts it once per target chat
        const [row] = await sql('select content from messages_lst_t where message_id = ?', [m[1]]);
        const text = row?.content ? decryptText(row.content) : 'x';
        const targets = [];
        for (const id of body.conversation_ids) {
            const conversationId = Number(id);
            targets.push(Number.isInteger(conversationId) && conversationId > 0
                ? { conversation_id: conversationId, ...(await encryptFor(baseUrl, token, conversationId, text)) }
                : { conversation_id: id, content: encryptText(text), key_version: 1 });
        }
        const { conversation_ids: _ids, ...rest } = body;
        return { ...rest, targets };
    }
    return body;
};

// one request as the app makes it: message text encrypted going out, decrypted coming back
const request = async (baseUrl, token, method, path, body) => {
    const res = await rawCall(baseUrl, token, method, path, await encryptBody(baseUrl, token, method, path, body));
    return { ...res, body: decryptDeep(res.body) };
};

// minimal rest client: returns { status, body, headers }
const api = (baseUrl, token) => {
    const call = (method, path, body) => request(baseUrl, token, method, path, body);
    return {
        get: (path) => call('GET', path),
        post: (path, body = {}) => call('POST', path, body),
        patch: (path, body = {}) => call('PATCH', path, body),
        del: (path) => call('DELETE', path)
    };
};

// registers + logs in a fresh user, returns { user, token, email, password }
const createUser = async (baseUrl, label) => {
    const email = `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${label}@test.local`;
    const password = 'Integration@123';
    const anon = api(baseUrl);
    const reg = await anon.post('/auth/signup', { email, password, fst_nm: label, date_of_birth: '1995-05-15', keys: fakeKeySet() });
    if (reg.status !== 201) throw new Error(`signup failed: ${JSON.stringify(reg.body)}`);
    const login = await anon.post('/auth/login', { email, password });
    if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
    const token = (login.headers.get('access-token') || '').replace(/^Bearer /, '');
    return { user: login.body.data.user, keys: login.body.data.keys, token, email, password };
};

// socket connected (or rejected) as a promise. the socket remembers where it connected, so a
// message:send can be encrypted like the app does it
const connectSocket = (baseUrl, token) => new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 4000 });
    socket.e2ee = { baseUrl, token };
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => { socket.close(); reject(error); });
});

// resolves with the first payload of `event` that satisfies `predicate` (message text decrypted)
const waitFor = (socket, event, predicate = () => true, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timed out waiting for ${event}`)); }, timeoutMs);
    const handler = (raw) => {
        const payload = decryptDeep(raw);
        if (!predicate(payload)) return;
        clearTimeout(timer); socket.off(event, handler); resolve(payload);
    };
    socket.on(event, handler);
});

const emitWithAck = async (socket, event, payload, timeoutMs = 4000) => {
    let out = payload;
    if (event === 'message:send' && socket.e2ee && payload && typeof payload === 'object') {
        out = { ...payload, ...(await encryptFor(socket.e2ee.baseUrl, socket.e2ee.token, payload.conversation_id, payload.content)) };
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), timeoutMs);
        socket.emit(event, out, (ack) => { clearTimeout(timer); resolve(decryptDeep(ack)); });
    });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        await sql(`delete e from message_edits_t e join messages_lst_t m on m.message_id = e.message_id where m.conversation_id in (${cm})`, convIds);
        await sql(`delete from scheduled_messages_t where conversation_id in (${cm})`, convIds);
        await sql(`delete from conversation_keys_t where conversation_id in (${cm})`, convIds);
        await sql(`delete from messages_lst_t where conversation_id in (${cm})`, convIds);
        await sql(`delete from conversation_members_t where conversation_id in (${cm})`, convIds);
        await sql(`delete from conversations_lst_t where conversation_id in (${cm})`, convIds);
    }
    // uploaded photos: the rows reference the users, the files live under server/uploads
    const files = await sql(`select file_path from uploaded_files_lst_t where uploaded_by in (${marks})`, userIds);
    await sql(`delete from uploaded_files_lst_t where uploaded_by in (${marks})`, userIds);
    for (const f of files) await require('fs').promises.unlink(require('../../server/utils/files.utils').resolveStoredPath(f.file_path)).catch(() => {});
    await sql(`delete from user_devices_t where user_id in (${marks})`, userIds);
    await sql(`delete from conversation_keys_t where user_id in (${marks}) or created_by in (${marks})`, [...userIds, ...userIds]);
    await sql(`delete from user_keys_t where user_id in (${marks})`, userIds);
    await sql(`delete from user_blocks_t where blocker_id in (${marks}) or blocked_id in (${marks})`, [...userIds, ...userIds]);
    await sql(`delete from audit_logs_t where user_id in (${marks})`, userIds);
    await sql(`delete from user_login_history_t where user_id in (${marks})`, userIds);
    await sql(`delete from user_sessions_t where user_id in (${marks})`, userIds);
    await sql(`delete from email_audit_logs_t where create_user in (${marks})`, userIds.map(String));
    await sql(`delete from users_lst_t where user_id in (${marks})`, userIds);
    await sql(`delete from audit_logs_t where user_id is null and created_at > now() - interval 1 hour and description like '%test.local%'`);
};

module.exports = { start, stop, api, request, rawCall, anonymousCall, createUser, connectSocket, waitFor, emitWithAck, sleep, sql, cleanupUsers, fakeKeySet, encryptText, decryptText };
