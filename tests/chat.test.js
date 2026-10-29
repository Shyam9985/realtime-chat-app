/*
 * Integration tests for the chat features (SRS v1.1 FR-001..FR-027, AT-001..AT-017).
 * Runs the real server against the configured MySQL. Run with: npm test
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, C, convId;
const sockets = [];
const track = (s) => { sockets.push(s); return s; };

before(async () => {
    app = await h.start();
    [A, B, C] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob'), h.createUser(app.baseUrl, 'Carol')]);
});

after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await h.cleanupUsers([A, B, C].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

const as = (u) => h.api(app.baseUrl, u.token);

// ---------------------------------------------------------------- health, auth, access
test('health reports the database as up', async () => {
    const res = await h.api(app.baseUrl).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.database, 'up');
});

test('AT-001 duplicate registration is rejected', async () => {
    const res = await h.api(app.baseUrl).post('/auth/signup', { email: A.email, password: A.password, fst_nm: 'Dup', date_of_birth: '1995-05-15', keys: h.fakeKeySet() });
    assert.equal(res.status, 409);
    assert.equal(res.body.statusKey, 'DUPLICATE_RECORD');
});

test('AT-002 wrong password is rejected', async () => {
    const res = await h.api(app.baseUrl).post('/auth/login', { email: A.email, password: 'Wrong@12345' });
    assert.equal(res.status, 401);
    assert.equal(res.body.statusKey, 'INVALID_CREDENTIALS');
});

test('unauthenticated rest and socket access is refused', async () => {
    const res = await h.api(app.baseUrl).get('/conversations');
    assert.equal(res.status, 401);
    await assert.rejects(h.connectSocket(app.baseUrl, undefined), (e) => e.data?.statusKey === 'INVALID_TOKEN');
    await assert.rejects(h.connectSocket(app.baseUrl, 'not.a.jwt'), (e) => e.data?.statusKey === 'INVALID_TOKEN');
});

// ---------------------------------------------------------------- discovery and conversations
test('FR-004 user search finds others and never the caller', async () => {
    const res = await as(A).get('/users?query=Bob');
    assert.equal(res.status, 200);
    const ids = res.body.data.users.map((u) => u.user_id);
    assert.ok(ids.includes(B.user.user_id));
    assert.ok(!ids.includes(A.user.user_id));
    const self = await as(A).get(`/users?query=${encodeURIComponent(A.email)}`);
    assert.equal(self.body.data.users.length, 0);
    const empty = await as(A).get('/users?query=');
    assert.deepEqual(empty.body.data.users, []);
});

test('AT-003 / FR-005 one conversation per pair, whichever side starts it', async () => {
    const first = await as(A).post('/conversations', { user_id: B.user.user_id });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.created, true);
    convId = first.body.data.conversation.conversation_id;
    assert.equal(first.body.data.conversation.other_user.user_id, B.user.user_id);

    const second = await as(B).post('/conversations', { user_id: A.user.user_id });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.created, false);
    assert.equal(second.body.data.conversation.conversation_id, convId);
    assert.equal(second.body.data.conversation.other_user.user_id, A.user.user_id);

    const again = await as(A).post('/conversations', { user_id: B.user.user_id });
    assert.equal(again.body.data.conversation.conversation_id, convId);
});

test('conversation creation validates the target', async () => {
    const self = await as(A).post('/conversations', { user_id: A.user.user_id });
    assert.equal(self.status, 400);
    assert.equal(self.body.statusKey, 'SELF_ACTION');
    const missing = await as(A).post('/conversations', { user_id: 999999999 });
    assert.equal(missing.status, 404);
    const bad = await as(A).post('/conversations', { user_id: 'abc' });
    assert.equal(bad.status, 400);
});

test('AT-007 / FR-006 non-members get nothing', async () => {
    const hist = await as(C).get(`/conversations/${convId}/messages`);
    assert.equal(hist.status, 403);
    assert.equal(hist.body.statusKey, 'NOT_A_MEMBER');
    const send = await as(C).post('/messages', { conversation_id: convId, content: 'hi' });
    assert.equal(send.status, 403);
    const seen = await as(C).post(`/conversations/${convId}/seen`);
    assert.equal(seen.status, 403);
    const ghost = await as(C).get('/conversations/999999999/messages');
    assert.equal(ghost.status, 403, 'a missing conversation looks the same as a foreign one');
});

// ---------------------------------------------------------------- real-time send, receipts
let sA, sB, firstMessage;

test('AT-004 / AT-005 a message is persisted, acked to the sender and pushed to the recipient', async () => {
    sA = track(await h.connectSocket(app.baseUrl, A.token));
    sB = track(await h.connectSocket(app.baseUrl, B.token));

    const incoming = h.waitFor(sB, 'message:new');
    const ack = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: '  hello bob  ', sender_id: C.user.user_id });
    assert.equal(ack.ok, true);
    firstMessage = ack.message;
    assert.equal(firstMessage.sender_id, A.user.user_id, 'sender comes from the socket, not the payload');
    assert.equal(firstMessage.content, 'hello bob', 'content is trimmed');
    assert.equal(firstMessage.status, 'SENT');

    const received = await incoming;
    assert.equal(received.message_id, firstMessage.message_id);

    const hist = await as(B).get(`/conversations/${convId}/messages`);
    assert.equal(hist.body.data.messages[0].message_id, firstMessage.message_id, 'persisted before it was broadcast');
});

test('FR-007 / FR-027 payload validation over the socket', async () => {
    for (const payload of [
        { conversation_id: convId, content: '' },
        { conversation_id: convId, content: '    ' },
        { conversation_id: convId, content: 'x'.repeat(9000) },     // the app stops at 2000 characters; the server bounds the encrypted size
        { conversation_id: convId },
        { content: 'no conversation' },
        { conversation_id: convId, content: 'ok', client_message_id: 'bad id with spaces' },
    ]) {
        const errorEvent = h.waitFor(sA, 'error');
        const ack = await h.emitWithAck(sA, 'message:send', payload);
        assert.equal(ack.ok, false);
        assert.equal(ack.error.statusKey, 'VALIDATION_ERROR');
        assert.equal((await errorEvent).statusKey, 'VALIDATION_ERROR');
    }
    const max = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'y'.repeat(2000) });
    assert.equal(max.ok, true, 'exactly the limit is accepted');
});

test('a resent client_message_id does not create a second row', async () => {
    const cid = `cm-${Date.now()}`;
    const before = (await as(A).get(`/conversations/${convId}/messages?limit=100`)).body.data.messages.length;
    const one = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'once', client_message_id: cid });
    const two = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'once', client_message_id: cid });
    assert.equal(one.ok && two.ok, true);
    assert.equal(two.message.message_id, one.message.message_id);
    assert.equal(two.duplicate, true);
    const afterCount = (await as(A).get(`/conversations/${convId}/messages?limit=100`)).body.data.messages.length;
    assert.equal(afterCount, before + 1);
});

test('AT-008 delivery ack reaches the sender and the stored status', async () => {
    const notified = h.waitFor(sA, 'message:delivered', (p) => p.message_id === firstMessage.message_id);
    const ack = await h.emitWithAck(sB, 'message:delivered', { message_id: firstMessage.message_id });
    assert.equal(ack.ok, true);
    const payload = await notified;
    assert.equal(payload.user_id, B.user.user_id);
    assert.ok(payload.delivered_at);

    const hist = await as(A).get(`/conversations/${convId}/messages?limit=100`);
    const row = hist.body.data.messages.find((m) => m.message_id === firstMessage.message_id);
    assert.equal(row.status, 'DELIVERED');

    const again = await h.emitWithAck(sB, 'message:delivered', { message_id: firstMessage.message_id });
    assert.equal(again.changed, false, 'second ack is a no-op');
    const notMine = await h.emitWithAck(sA, 'message:delivered', { message_id: firstMessage.message_id });
    assert.equal(notMine.ok, false, 'a sender has no receipt on their own message');
});

test('AT-009 seen marks the whole conversation and clears unread', async () => {
    const unreadBefore = (await as(B).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === convId).unread_count;
    assert.ok(unreadBefore >= 1);

    const notified = h.waitFor(sA, 'message:seen', (p) => p.conversation_id === convId);
    const ack = await h.emitWithAck(sB, 'message:seen', { conversation_id: convId });
    assert.equal(ack.ok, true);
    assert.equal(ack.changed, unreadBefore);
    const payload = await notified;
    assert.ok(payload.message_ids.includes(firstMessage.message_id));

    const hist = await as(A).get(`/conversations/${convId}/messages?limit=100`);
    assert.ok(hist.body.data.messages.every((m) => m.status === 'SEEN'));
    const unreadAfter = (await as(B).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === convId).unread_count;
    assert.equal(unreadAfter, 0);
});

test("the chat list reports the last message's ticks: sent, then delivered, then seen", async () => {
    const lastOf = async (u) => (await as(u).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === convId).last_message;
    const sent = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'tick check' });
    assert.equal(sent.ok, true);
    const id = sent.message.message_id;

    let last = await lastOf(A);
    assert.equal(last.message_id, id);
    assert.equal(last.status, 'SENT', "one tick until the recipient's device has it");

    await h.emitWithAck(sB, 'message:delivered', { message_id: id });
    last = await lastOf(A);
    assert.equal(last.status, 'DELIVERED');

    await h.emitWithAck(sB, 'message:seen', { conversation_id: convId });
    last = await lastOf(A);
    assert.equal(last.status, 'SEEN');
});

test('AT-006 / FR-011 an offline recipient recovers messages and they are marked delivered on reconnect', async () => {
    sB.close();
    await h.sleep(200);
    const m1 = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'while you were away 1' });
    const m2 = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'while you were away 2' });
    assert.equal(m1.message.status, 'SENT');

    const list = (await as(B).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === convId);
    assert.equal(list.unread_count, 2);
    assert.equal(list.last_message.content, 'while you were away 2');

    const d1 = h.waitFor(sA, 'message:delivered', (p) => p.message_id === m1.message.message_id);
    const d2 = h.waitFor(sA, 'message:delivered', (p) => p.message_id === m2.message.message_id);
    sB = track(await h.connectSocket(app.baseUrl, B.token));
    await Promise.all([d1, d2]);

    const hist = await as(B).get(`/conversations/${convId}/messages?limit=2`);
    assert.deepEqual(hist.body.data.messages.map((m) => m.content), ['while you were away 2', 'while you were away 1']);
    assert.equal(hist.body.data.messages[0].status, 'DELIVERED');
});

// ---------------------------------------------------------------- history paging
test('FR-010 keyset pagination is stable and ordered by (created_at, message_id)', async () => {
    for (let i = 1; i <= 5; i++) {
        const res = await as(B).post('/messages', { conversation_id: convId, content: `page ${i}` });
        assert.equal(res.status, 201);
    }
    const page1 = await as(A).get(`/conversations/${convId}/messages?limit=2`);
    assert.equal(page1.body.data.messages.length, 2);
    assert.equal(page1.body.data.has_more, true);
    assert.deepEqual(page1.body.data.messages.map((m) => m.content), ['page 5', 'page 4']);

    const page2 = await as(A).get(`/conversations/${convId}/messages?limit=2&cursor=${encodeURIComponent(page1.body.data.next_cursor)}`);
    assert.deepEqual(page2.body.data.messages.map((m) => m.content), ['page 3', 'page 2']);
    const ids1 = page1.body.data.messages.map((m) => m.message_id);
    assert.ok(page2.body.data.messages.every((m) => !ids1.includes(m.message_id)), 'no overlap between pages');

    const all = [];
    let cursor = null;
    do {
        const res = await as(A).get(`/conversations/${convId}/messages?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        all.push(...res.body.data.messages);
        cursor = res.body.data.next_cursor;
    } while (cursor);
    for (let i = 1; i < all.length; i++) {
        assert.ok(all[i - 1].created_at > all[i].created_at || (all[i - 1].created_at === all[i].created_at && all[i - 1].message_id > all[i].message_id));
    }
    const bad = await as(A).get(`/conversations/${convId}/messages?cursor=%%%garbage`);
    assert.equal(bad.status, 400);
});

// ---------------------------------------------------------------- blocking
test('AT-010 / FR-015..FR-019 blocking is directional, enforced server-side, and keeps history', async () => {
    const self = await as(A).post(`/users/${A.user.user_id}/block`);
    assert.equal(self.status, 400);
    assert.equal(self.body.statusKey, 'SELF_ACTION');

    const block = await as(A).post(`/users/${B.user.user_id}/block`);
    assert.equal(block.status, 200);
    assert.equal(block.body.data.blocked, true);
    const again = await as(A).post(`/users/${B.user.user_id}/block`);
    assert.equal(again.body.data.changed, false, 'blocking twice is idempotent');

    // B -> A is refused on both transports
    const errorEvent = h.waitFor(sB, 'error');
    const viaSocket = await h.emitWithAck(sB, 'message:send', { conversation_id: convId, content: 'can you hear me?' });
    assert.equal(viaSocket.ok, false);
    assert.equal(viaSocket.error.statusKey, 'BLOCKED');
    assert.equal((await errorEvent).statusKey, 'BLOCKED');
    const viaRest = await as(B).post('/messages', { conversation_id: convId, content: 'can you hear me?' });
    assert.equal(viaRest.status, 403);
    assert.equal(viaRest.body.statusKey, 'BLOCKED');

    // A -> B still works (directional)
    const incoming = h.waitFor(sB, 'message:new');
    const fromA = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'blocked you, still talking' });
    assert.equal(fromA.ok, true);
    assert.equal((await incoming).message_id, fromA.message.message_id);

    // history remains visible to both
    const histB = await as(B).get(`/conversations/${convId}/messages?limit=100`);
    assert.equal(histB.status, 200);
    assert.ok(histB.body.data.messages.length >= 10);
    const listA = (await as(A).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === convId);
    assert.equal(listA.blocked_by_me, true);

    // the blocked user cannot discover the blocker
    const search = await as(B).get('/users?query=Alice');
    assert.ok(!search.body.data.users.some((u) => u.user_id === A.user.user_id));
    const blockedList = await as(A).get('/users/blocked');
    assert.ok(blockedList.body.data.users.some((u) => u.user_id === B.user.user_id));
});

test('AT-011 / FR-018 unblocking re-enables messages', async () => {
    const un = await as(A).del(`/users/${B.user.user_id}/block`);
    assert.equal(un.status, 200);
    assert.equal(un.body.data.blocked, false);
    const twice = await as(A).del(`/users/${B.user.user_id}/block`);
    assert.equal(twice.body.data.changed, false);

    const incoming = h.waitFor(sA, 'message:new');
    const ack = await h.emitWithAck(sB, 'message:send', { conversation_id: convId, content: 'back again' });
    assert.equal(ack.ok, true);
    assert.equal((await incoming).content, 'back again');
});

// ---------------------------------------------------------------- delete for everyone
test('AT-012 / AT-014 / AT-015 sender deletes within the window; others see the placeholder only', async () => {
    const sent = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'oops wrong chat' });
    const id = sent.message.message_id;

    const notOwner = await as(B).del(`/messages/${id}`);
    assert.equal(notOwner.status, 403);
    assert.equal(notOwner.body.statusKey, 'FORBIDDEN');
    const outsider = await as(C).del(`/messages/${id}`);
    assert.equal(outsider.status, 403);

    const bNotified = h.waitFor(sB, 'message:deleted', (p) => p.message_id === id);
    const aNotified = h.waitFor(sA, 'message:deleted', (p) => p.message_id === id);
    const del = await as(A).del(`/messages/${id}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.data.message.is_deleted, true);
    assert.equal(del.body.data.message.content, null);
    await Promise.all([bNotified, aNotified]);

    for (const u of [A, B]) {
        const hist = await as(u).get(`/conversations/${convId}/messages?limit=100`);
        const row = hist.body.data.messages.find((m) => m.message_id === id);
        assert.equal(row.is_deleted, true);
        assert.equal(row.content, null, 'original content never leaves the server');
        assert.ok(row.deleted_at);
    }
    const [{ content }] = await h.sql('select content from messages_lst_t where message_id = ?', [id]);
    assert.equal(h.decryptText(content), 'oops wrong chat', 'the row keeps its position and (encrypted) content for the record');

    const again = await as(A).del(`/messages/${id}`);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.already, true);
    const missing = await as(A).del('/messages/999999999');
    assert.equal(missing.status, 404);
});

test('AT-013 / FR-021 deletion after 15 minutes is refused using the server clock', async () => {
    const sent = await h.emitWithAck(sA, 'message:send', { conversation_id: convId, content: 'too late to regret' });
    const id = sent.message.message_id;
    await h.sql('update messages_lst_t set created_at = created_at - interval 16 minute where message_id = ?', [id]);

    const del = await as(A).del(`/messages/${id}`);
    assert.equal(del.status, 403);
    assert.equal(del.body.statusKey, 'DELETE_WINDOW_EXPIRED');
    const hist = await as(B).get(`/conversations/${convId}/messages?limit=100`);
    const row = hist.body.data.messages.find((m) => m.message_id === id);
    assert.equal(row.is_deleted, false);
    assert.equal(row.content, 'too late to regret');
});

// ---------------------------------------------------------------- account state and sessions
test('FR-025 an inactive account can neither log in nor connect', async () => {
    await h.sql('update users_lst_t set is_active = 0 where user_id = ?', [C.user.user_id]);
    const login = await h.api(app.baseUrl).post('/auth/login', { email: C.email, password: C.password });
    assert.equal(login.status, 401);
    await assert.rejects(h.connectSocket(app.baseUrl, C.token), (e) => e.data?.statusKey === 'ACCOUNT_INACTIVE');
    await h.sql('update users_lst_t set is_active = 1 where user_id = ?', [C.user.user_id]);
});

test('socket sends are rate limited per user', async () => {
    const sC = track(await h.connectSocket(app.baseUrl, C.token));
    const conv = (await as(C).post('/conversations', { user_id: A.user.user_id })).body.data.conversation.conversation_id;
    const acks = await Promise.all(Array.from({ length: 40 }, (_, i) => h.emitWithAck(sC, 'message:send', { conversation_id: conv, content: `burst ${i}` })));
    const limited = acks.filter((a) => !a.ok && a.error.statusKey === 'TOOMANY_REQUESTS');
    assert.ok(limited.length >= 5, `expected the burst to be throttled, got ${limited.length} rejections`);
    assert.ok(acks.filter((a) => a.ok).length >= 30, 'the allowed burst still goes through');
    sC.close();
});

test('another member\'s profile and photo, and what a block hides', async () => {
    const prof = await as(B).get(`/users/${A.user.user_id}`);
    assert.equal(prof.status, 200);
    const u = prof.body.data.user;
    assert.equal(u.user_id, A.user.user_id);
    assert.equal(u.first_nm, 'Alice');
    assert.equal(u.conversation_id, convId);
    assert.equal(u.has_photo, false);
    assert.ok(u.member_since);
    for (const hidden of ['password_hash', 'password_salt', 'mobile_no', 'login_attempts', 'is_locked', 'user_nm']) assert.ok(!(hidden in u), `${hidden} must not be exposed`);
    assert.equal((await as(B).get('/users/999999999')).status, 404);
    assert.equal((await as(B).get('/users/abc')).status, 400);

    // no photo yet -> 404; once A uploads one, B receives exactly those bytes
    assert.equal((await as(B).get(`/users/${A.user.user_id}/photo`)).status, 404);
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await fetch(`${app.baseUrl}/apiv1/files/upload`, { method: 'POST', body: PNG,
        headers: { 'access-token': `Bearer ${A.token}`, 'content-type': 'image/png', 'x-file-name': 'a.png' } });
    assert.equal(up.status, 201);
    const photo = await fetch(`${app.baseUrl}/apiv1/users/${A.user.user_id}/photo`, { headers: { 'access-token': `Bearer ${B.token}` } });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg', 'every photo is stored as a compressed jpeg');
    assert.deepEqual([...Buffer.from(await photo.arrayBuffer()).subarray(0, 3)], [0xff, 0xd8, 0xff], 'jpeg bytes');
    const withPhoto = (await as(B).get(`/users/${A.user.user_id}`)).body.data.user;
    assert.equal(withPhoto.has_photo, true);
    assert.ok(withPhoto.profile_photo_url);

    // when A blocks B, B still sees A's name but not the photo, and nothing says a block exists
    await as(A).post(`/users/${B.user.user_id}/block`);
    const whileBlocked = await as(B).get(`/users/${A.user.user_id}`);
    assert.equal(whileBlocked.status, 200);
    assert.equal(whileBlocked.body.data.user.has_photo, false);
    assert.equal(whileBlocked.body.data.user.profile_photo_url, null);
    assert.ok(!('has_blocked_me' in whileBlocked.body.data.user));
    const hiddenPhoto = await as(B).get(`/users/${A.user.user_id}/photo`);
    assert.equal(hiddenPhoto.status, 404, 'same answer as "no photo"');
    assert.equal((await as(A).get(`/users/${B.user.user_id}`)).body.data.user.blocked_by_me, true);
    await as(A).del(`/users/${B.user.user_id}/block`);
    assert.equal((await fetch(`${app.baseUrl}/apiv1/users/${A.user.user_id}/photo`, { headers: { 'access-token': `Bearer ${B.token}` } })).status, 200);
});

test('logout from the mobile client (jwt only) invalidates the socket session', async () => {
    const out = await as(B).post('/auth/logout');
    assert.equal(out.status, 200);
    await assert.rejects(h.connectSocket(app.baseUrl, B.token), (e) => e.data?.statusKey === 'SESSION_EXPIRED');
    const rest = await as(B).get('/conversations');
    assert.equal(rest.status, 401, 'the old jwt is refused over rest as well');
    assert.equal(rest.body.statusKey, 'SESSION_EXPIRED');
});
