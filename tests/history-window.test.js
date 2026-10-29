/*
 * Integration tests for opening a chat with the last N days (GET /conversations/:id/messages?days=7):
 * the whole recent window comes at once, a quiet chat still opens with its newest messages, and older
 * pages follow with the cursor. Real server, real database.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, C, busy, quiet;
const as = (u) => h.api(app.baseUrl, u.token);
const page = async (conversationId, query) => (await as(A).get(`/conversations/${conversationId}/messages?${query}`)).body.data;

// n messages from A, then moved daysAgo into the past (one second apart, keeping their order)
const sendAged = async (conversationId, n, daysAgo, label) => {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
        ids.push((await as(A).post('/messages', { conversation_id: conversationId, content: `${label} ${i}`, client_message_id: `hw-${label.replace(/\W/g, '')}-${i}-${Date.now() % 1e7}` })).body.data.message.message_id);
    }
    if (daysAgo) {
        await h.sql(`update messages_lst_t set created_at = now(3) - interval ${daysAgo} day - interval (? - message_id) second where message_id in (${ids.map(() => '?').join(',')})`,
            [Math.max(...ids), ...ids]);
    }
    return ids;
};

before(async () => {
    app = await h.start();
    [A, B, C] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob'), h.createUser(app.baseUrl, 'Carol')]);
    busy = (await as(A).post('/conversations', { user_id: B.user.user_id })).body.data.conversation.conversation_id;
    quiet = (await as(A).post('/conversations', { user_id: C.user.user_id })).body.data.conversation.conversation_id;
    await sendAged(busy, 5, 12, 'old');       // before the window
    await sendAged(busy, 25, 0, 'recent');    // this week
    await sendAged(quiet, 30, 20, 'long ago');
    await sendAged(quiet, 3, 0, 'new');
});

after(async () => {
    await h.cleanupUsers([A, B, C].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

test('HW-01 a chat opens with everything from the last 7 days, older pages follow when scrolling', async () => {
    const first = await page(busy, 'days=7');
    assert.equal(first.messages.length, 25, 'the whole week at once');
    assert.ok(first.messages.every((m) => m.content.startsWith('recent')));
    assert.equal(first.has_more, true);
    const older = await page(busy, `cursor=${first.next_cursor}`);
    assert.deepEqual(older.messages.map((m) => m.content), ['old 4', 'old 3', 'old 2', 'old 1', 'old 0']);
    assert.equal(older.has_more, false);
});

test('HW-02 a quiet chat (few messages this week) still opens with its newest 20', async () => {
    const first = await page(quiet, 'days=7');
    assert.equal(first.messages.length, 20);
    assert.deepEqual(first.messages.slice(0, 3).map((m) => m.content), ['new 2', 'new 1', 'new 0']);
    assert.equal(first.has_more, true);
});

test('HW-03 days must be 1 to 90; without it the paging is unchanged', async () => {
    for (const bad of ['0', '91', 'abc']) assert.equal((await as(A).get(`/conversations/${busy}/messages?days=${bad}`)).status, 400, bad);
    assert.equal((await page(busy, 'limit=10')).messages.length, 10);
});
