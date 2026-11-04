/*
 * Integration tests for push-notification device registration (POST /devices, POST /devices/unregister).
 * Real server, real database.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B;
const token = `fcm-test-${Date.now()}-${'x'.repeat(140)}`;
const as = (u) => h.api(app.baseUrl, u.token);
const rowsFor = (t) => h.sql('select user_id, platform, is_active from user_devices_t where push_token = ?', [t]);

before(async () => {
    app = await h.start();
    [A, B] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob')]);
});

after(async () => {
    await h.cleanupUsers([A, B].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

test('PN-01 a signed-in user registers this phone; registering again keeps one row', async () => {
    assert.equal((await as(A).post('/devices', { push_token: token, platform: 'android' })).status, 200);
    assert.equal((await as(A).post('/devices', { push_token: token })).status, 200);
    const rows = await rowsFor(token);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, A.user.user_id);
    assert.equal(rows[0].is_active, 1);
});

test('PN-02 another account signing in on the same phone takes the token over', async () => {
    await as(B).post('/devices', { push_token: token });
    const rows = await rowsFor(token);
    assert.equal(rows.length, 1, 'still one row: the phone moved');
    assert.equal(rows[0].user_id, B.user.user_id);
});

test('PN-03 sign-out switches the phone off, and only the owner can do that', async () => {
    assert.equal((await as(A).post('/devices/unregister', { push_token: token })).body.data.unregistered, false, 'Alice no longer owns it');
    assert.equal((await as(B).post('/devices/unregister', { push_token: token })).body.data.unregistered, true);
    assert.equal((await rowsFor(token))[0].is_active, 0);
    assert.equal((await as(B).post('/devices', { push_token: token })).status, 200);
    assert.equal((await rowsFor(token))[0].is_active, 1, 'signing in again switches it back on');
});

// talks to the real firebase: a made-up token is refused there, and the server switches it off.
// proves the key loads and the server can reach firebase, without needing a phone
test('PN-05 a new message is pushed through firebase; a token firebase rejects is switched off', { skip: !process.env.FIREBASE_SERVICE_ACCOUNT_FILE && 'FIREBASE_SERVICE_ACCOUNT_FILE is not set' }, async () => {
    const fake = `fcm-dead-${Date.now()}-${'y'.repeat(140)}`;
    await as(A).post('/devices', { push_token: fake });
    const direct = (await as(B).post('/conversations', { user_id: A.user.user_id })).body.data.conversation.conversation_id;
    assert.equal((await as(B).post('/messages', { conversation_id: direct, content: 'ping', client_message_id: `pn-${Date.now()}` })).status, 201);
    let row;
    for (let i = 0; i < 40 && (!row || row.is_active); i += 1) {      // the push goes out after the send, give it up to 10 s
        await h.sleep(250);
        [row] = await rowsFor(fake);
    }
    assert.equal(row.is_active, 0, 'firebase rejected the made-up token and the server stopped using it');
});

// the push's data: firebase refuses the whole push over one reserved key ("message_type" sank 1.5.0's
// notifications) and over any non-string value, so the shape is pinned here
test('PN-06 a message push carries only string values under keys firebase accepts; a sticker travels without its id', () => {
    const pushService = require('../server/services/pushService');
    const heading = { chatTitle: 'Goa Trip', sender: 'Noah', group: true };
    const data = pushService.messageDataOf({ message_id: 7, conversation_id: 3, sender_id: 9, message_type: 'TEXT', content: 'ZW5jOmhp', key_version: 2, enc_format: 1 }, heading);
    for (const [key, value] of Object.entries(data)) {
        assert.equal(typeof value, 'string', `${key} must be a string`);
        assert.doesNotMatch(key, pushService.RESERVED_KEY, `${key} is reserved by firebase`);
    }
    assert.equal(data.msg_type, 'TEXT');
    assert.equal(data.content, 'ZW5jOmhp');
    assert.equal(data.is_group, '1');
    assert.equal(data.chat_title, 'Goa Trip');
    assert.equal(data.key_version, '2');

    const sticker = pushService.messageDataOf({ message_id: 8, conversation_id: 3, sender_id: 9, message_type: 'STICKER', content: 'ZW5jOjEy', key_version: 2, enc_format: 1 }, heading);
    assert.equal(sticker.msg_type, 'STICKER');
    assert.equal(sticker.content, '', 'a sticker id is not worth a preview; the phone says "Sticker"');
    assert.equal(pushService.messageDataOf({ message_id: 9, conversation_id: 3, sender_id: 9, content: 'x'.repeat(3001) }, heading).content, '', 'too long for a push');
});

// the real firebase backend checks the payload before it looks at the token: a push it accepts answers
// "not registered" for a made-up token, a payload it refuses answers "invalid-argument" for every token
test('PN-07 firebase accepts the message push payload itself (a made-up token is reported dead, not the payload)', { skip: !process.env.FIREBASE_SERVICE_ACCOUNT_FILE && 'FIREBASE_SERVICE_ACCOUNT_FILE is not set' }, async () => {
    const pushService = require('../server/services/pushService');
    // shaped like a real token (firebase checks the shape first, then whether a phone has it)
    const fake = `d${Date.now()}${'x'.repeat(120)}:APA91b${'y'.repeat(130)}`;
    await as(A).post('/devices', { push_token: fake });
    const direct = (await as(B).post('/conversations', { user_id: A.user.user_id })).body.data.conversation.conversation_id;
    const message = { message_id: 1, conversation_id: direct, sender_id: B.user.user_id, sender_name: 'Bob', message_type: 'STICKER', content: 'ZW5jOjEy', key_version: 1, enc_format: 1 };
    const result = await pushService.onMessageCreated({ message, recipientIds: [A.user.user_id] });
    assert.ok(result.errors.includes('messaging/registration-token-not-registered'), JSON.stringify(result));
    assert.ok(!result.errors.includes('messaging/invalid-argument'), `the payload was refused: ${JSON.stringify(result)}`);
    assert.equal((await rowsFor(fake))[0].is_active, 0, 'the made-up token is switched off');
    await assert.rejects(pushService.sendToUsers([A.user.user_id], { type: 'message', message_type: 'TEXT' }), /reserves: message_type/);
});

test('PN-04 bad input and no sign-in are refused', async () => {
    assert.equal((await as(A).post('/devices', {})).status, 400);
    assert.equal((await as(A).post('/devices', { push_token: 'short' })).status, 400);
    assert.equal((await as(A).post('/devices', { push_token: 'has spaces in it '.repeat(3) })).status, 400);
    assert.equal((await as(A).post('/devices', { push_token: token, platform: 'windows' })).status, 400);
    assert.equal((await h.api(app.baseUrl).post('/devices', { push_token: token })).status, 401);
});
