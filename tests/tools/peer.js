/*
 * A scripted chat partner for manual ui testing.
 *
 *   node tests/tools/peer.js [email] [firstName]            (defaults: noah.peer@test.local Noah)
 *
 * registers the account if needed, logs in, connects a socket and then:
 *   - acknowledges every incoming message as delivered, marks the conversation seen 1s later
 *   - replies "Got it: <text>" 2s after each message
 *   - every 20s tries to send "ping" to each conversation it knows, so a block can be observed
 * prints every event it sees. ctrl+c to stop.
 */
require('dotenv').config();
const { io } = require('socket.io-client');

const BASE = process.env.PEER_API_URL || `http://127.0.0.1:${process.env.PORT || 4200}`;
const EMAIL = process.argv[2] || 'noah.peer@test.local';
const NAME = process.argv[3] || 'Noah';
const PASSWORD = 'Peer@12345';

const api = async (method, path, body, token) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['access-token'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}/apiv1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, token: (res.headers.get('access-token') || '').replace(/^Bearer /, '') };
};

const stamp = () => new Date().toISOString().slice(11, 19);
const say = (...a) => console.log(`[peer ${stamp()}]`, ...a);

(async () => {
    const reg = await api('POST', '/auth/signup', { email: EMAIL, password: PASSWORD, fst_nm: NAME, lst_nm: 'Peer' });
    say(reg.status === 201 ? 'registered' : `signup: ${reg.body?.statusKey}`);
    const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
    if (login.status !== 200) { console.error('login failed', login.body); process.exit(1); }
    const token = login.token;
    const me = login.body.data.user;
    say(`logged in as ${me.first_nm} (user_id ${me.user_id})`);

    const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
    const conversations = new Set();
    const ack = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

    socket.on('connect', () => say('socket connected'));
    socket.on('connect_error', (e) => say('connect_error', e.data || e.message));
    socket.on('disconnect', (r) => say('disconnected', r));
    socket.on('error', (e) => say('error event', e));

    socket.on('message:new', async (m) => {
        say(`message:new #${m.message_id} from ${m.sender_id}: ${JSON.stringify(m.content)}`);
        conversations.add(m.conversation_id);
        say('delivered ->', (await ack('message:delivered', { message_id: m.message_id })).ok);
        setTimeout(async () => say('seen ->', (await ack('message:seen', { conversation_id: m.conversation_id })).ok), 1000);
        setTimeout(async () => {
            const r = await ack('message:send', { conversation_id: m.conversation_id, content: `Got it: ${m.content}` });
            say('reply ->', r.ok ? `#${r.message.message_id}` : r.error);
        }, 2000);
    });
    socket.on('message:delivered', (p) => say(`my #${p.message_id} delivered`));
    socket.on('message:seen', (p) => say(`my messages seen in conversation ${p.conversation_id}: ${p.message_ids.join(',')}`));
    socket.on('message:deleted', (p) => say(`message #${p.message_id} deleted for everyone`));
    socket.on('conversation:new', (p) => { say('conversation:new', p.conversation_id); conversations.add(p.conversation_id); });

    setInterval(async () => {
        for (const id of conversations) {
            const r = await ack('message:send', { conversation_id: id, content: 'ping' });
            say(`ping -> conversation ${id}:`, r.ok ? `#${r.message.message_id}` : `${r.error.statusKey} (${r.error.message})`);
        }
    }, 20000);
})();
