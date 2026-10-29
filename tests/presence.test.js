/*
 * Integration tests for "online" / "last seen": a user is online while a phone is connected, "last seen"
 * is saved when the last connection closes, one-to-one chat partners hear it live, and a block hides it
 * both ways. Real server, real database, real sockets.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, C, D, sA;
const sockets = [];
const as = (u) => h.api(app.baseUrl, u.token);
const profile = async (viewer, u) => (await as(viewer).get(`/users/${u.user.user_id}`)).body.data.user;
const quiet = (socket, event, predicate, ms = 500) => h.waitFor(socket, event, predicate, ms).then(() => false, () => true);

before(async () => {
    app = await h.start();
    [A, B, C, D] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave'].map((n) => h.createUser(app.baseUrl, n)));
    for (const other of [B, C]) await as(A).post('/conversations', { user_id: other.user.user_id });
    sA = await h.connectSocket(app.baseUrl, A.token);
    sockets.push(sA);
});

after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await h.cleanupUsers([A, B, C, D].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

test('PS-01 a chat partner coming online is seen live, and on their profile', async () => {
    const online = h.waitFor(sA, 'presence:update', (e) => e.user_id === B.user.user_id && e.online);
    const sB = await h.connectSocket(app.baseUrl, B.token);
    sockets.push(sB);
    await online;
    assert.equal((await profile(A, B)).online, true);

    const offline = h.waitFor(sA, 'presence:update', (e) => e.user_id === B.user.user_id && !e.online);
    sB.close();
    const event = await offline;
    assert.ok(event.last_seen_at, 'going offline carries the last seen time');
    const after = await profile(A, B);
    assert.equal(after.online, false);
    assert.equal(after.last_seen_at, event.last_seen_at);
});

test('PS-02 only one-to-one chat partners are told', async () => {
    const notAlice = quiet(sA, 'presence:update', (e) => e.user_id === D.user.user_id);
    const sD = await h.connectSocket(app.baseUrl, D.token);
    sockets.push(sD);
    assert.equal(await notAlice, true, 'Alice and Dave have no chat');
    sD.close();
});

test('PS-03 a block hides online and last seen, both ways', async () => {
    assert.equal((await as(A).post(`/users/${C.user.user_id}/block`, {})).status, 200);
    const notAlice = quiet(sA, 'presence:update', (e) => e.user_id === C.user.user_id);
    const sC = await h.connectSocket(app.baseUrl, C.token);
    sockets.push(sC);
    assert.equal(await notAlice, true);
    const seenByA = await profile(A, C);
    assert.equal(seenByA.online, null);
    assert.equal(seenByA.last_seen_at, null);
    const seenByC = await profile(C, A);
    assert.equal(seenByC.online, null, 'the blocked person does not see the blocker either');
    sC.close();
});
