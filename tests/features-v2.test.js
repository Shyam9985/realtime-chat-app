/*
 * Integration tests for release 2 (documents/testing/test-cases-v2.md): chat names, pin / archive,
 * read all, search, edit with history, reply, forward and scheduled messages. Real server, real
 * database, real sockets; ids in the test names point at the test-case document.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, C, ab, ac, sA, sB;
const sockets = [];
const track = (s) => { sockets.push(s); return s; };
const as = (u) => h.api(app.baseUrl, u.token);
const patch = (u, path, body) => h.request(app.baseUrl, u.token, 'PATCH', path, body);
const listOf = async (u) => (await as(u).get('/conversations')).body.data.conversations;
const send = async (socket, conversation_id, content, extra = {}) => {
    const ack = await h.emitWithAck(socket, 'message:send', { conversation_id, content, ...extra });
    assert.equal(ack.ok, true, JSON.stringify(ack.error));
    return ack.message;
};

before(async () => {
    app = await h.start();
    [A, B, C] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob'), h.createUser(app.baseUrl, 'Carol')]);
    ab = (await as(A).post('/conversations', { user_id: B.user.user_id })).body.data.conversation.conversation_id;
    ac = (await as(A).post('/conversations', { user_id: C.user.user_id })).body.data.conversation.conversation_id;
    sA = track(await h.connectSocket(app.baseUrl, A.token));
    sB = track(await h.connectSocket(app.baseUrl, B.token));
});

after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await h.cleanupUsers([A, B, C].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

// ---------------------------------------------------------------- names, pin, archive
test('TI-01 each member sees the chat named after the other person', async () => {
    assert.equal((await listOf(A)).find((c) => c.conversation_id === ab).title, 'Bob');
    assert.equal((await listOf(B)).find((c) => c.conversation_id === ab).title, 'Alice');
});

test('TI-02 / TI-03 / TI-06 renaming is personal, validated, and resets when blank', async () => {
    const renamed = await patch(A, `/conversations/${ab}/settings`, { custom_title: '  Bestie  ' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.conversation.title, 'Bestie');
    assert.equal((await listOf(B)).find((c) => c.conversation_id === ab).title, 'Alice', 'the other member is unaffected');

    const tooLong = await patch(A, `/conversations/${ab}/settings`, { custom_title: 'x'.repeat(101) });
    assert.equal(tooLong.status, 400);
    const wrongType = await patch(A, `/conversations/${ab}/settings`, { is_pinned: 'yes' });
    assert.equal(wrongType.status, 400);
    const nothing = await patch(A, `/conversations/${ab}/settings`, {});
    assert.equal(nothing.status, 400);

    const reset = await patch(A, `/conversations/${ab}/settings`, { custom_title: '' });
    assert.equal(reset.body.data.conversation.title, 'Bob');

    const foreign = await patch(C, `/conversations/${ab}/settings`, { custom_title: 'mine now' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.statusKey, 'NOT_A_MEMBER');
});

test('PA-02 / PA-04 / PA-05 / PA-10 pinned chats stay on top; pinning is personal and reaches other devices', async () => {
    const updated = h.waitFor(sA, 'conversation:updated', (c) => c.conversation_id === ac && c.is_pinned);
    const pinned = await patch(A, `/conversations/${ac}/settings`, { is_pinned: true });
    assert.equal(pinned.body.data.conversation.is_pinned, true);
    assert.ok(pinned.body.data.conversation.pinned_at);
    await updated;

    await send(sA, ab, 'activity in the unpinned chat');
    const list = await listOf(A);
    assert.equal(list[0].conversation_id, ac, 'pinned chat stays above newer activity');
    assert.equal((await listOf(B)).find((c) => c.conversation_id === ab).is_pinned, false);

    await patch(A, `/conversations/${ac}/settings`, { is_pinned: false });
    assert.equal((await listOf(A))[0].conversation_id, ab, 'unpinned: back to activity order');
});

test('PA-06 / PA-08 / PA-09 archiving unpins, and new messages keep the chat archived', async () => {
    await patch(A, `/conversations/${ab}/settings`, { is_pinned: true });
    const archived = await patch(A, `/conversations/${ab}/settings`, { is_archived: true });
    assert.equal(archived.body.data.conversation.is_archived, true);
    assert.equal(archived.body.data.conversation.is_pinned, false, 'archiving unpins');

    await send(sB, ab, 'hello from Bob while archived');
    const row = (await listOf(A)).find((c) => c.conversation_id === ab);
    assert.equal(row.is_archived, true);
    assert.ok(row.unread_count >= 1);

    await patch(A, `/conversations/${ab}/settings`, { is_archived: false });
    assert.equal((await listOf(A)).find((c) => c.conversation_id === ab).is_archived, false);
});

// ---------------------------------------------------------------- read all
test('CL-03 / CL-06 / CL-07 read all marks every unread chat seen, archived included, for the caller only', async () => {
    await send(sB, ab, 'unread one');
    await patch(A, `/conversations/${ab}/settings`, { is_archived: true });
    const cMsg = (await as(C).post('/messages', { conversation_id: ac, content: 'from Carol' })).body.data.message;
    const bBefore = (await listOf(B)).find((c) => c.conversation_id === ab).unread_count;

    const seenByB = h.waitFor(sB, 'message:seen', (p) => p.conversation_id === ab);
    const res = await as(A).post('/conversations/read-all');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.conversations, 2);
    await seenByB;
    assert.ok((await listOf(A)).every((c) => c.unread_count === 0));
    assert.equal((await listOf(B)).find((c) => c.conversation_id === ab).unread_count, bBefore, "B's counts are untouched");
    const hist = await as(C).get(`/conversations/${ac}/messages?limit=5`);
    assert.equal(hist.body.data.messages.find((m) => m.message_id === cMsg.message_id).status, 'SEEN');

    const again = await as(A).post('/conversations/read-all');
    assert.equal(again.body.data.conversations, 0, 'nothing left to mark');
    await patch(A, `/conversations/${ab}/settings`, { is_archived: false });
});

// ---------------------------------------------------------------- search (on the phone now)
test('CS-08 messages are stored encrypted, so the server has no search route any more', async () => {
    const sent = await send(sA, ab, 'Pizza tonight at Luigi');
    const [row] = await h.sql('select content, key_version, enc_format from messages_lst_t where message_id = ?', [sent.message_id]);
    assert.notEqual(row.content, 'Pizza tonight at Luigi', 'only the encrypted text is stored');
    assert.equal(row.enc_format, 1);
    assert.ok(row.key_version >= 1);
    assert.equal((await as(A).get(`/conversations/${ab}/messages/search?q=pizza`)).status, 404);
});

// ---------------------------------------------------------------- edit
test('ED-01 / ED-03 / ED-07 / ED-08 editing within the window: live, history kept, previews follow', async () => {
    const original = await send(sA, ab, 'See you at 5');
    const reply = await send(sB, ab, 'ok!', { reply_to_message_id: original.message_id });

    const live = h.waitFor(sB, 'message:edited', (m) => m.message_id === original.message_id);
    const first = await patch(A, `/messages/${original.message_id}`, { content: 'See you at 6' });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.message.is_edited, true);
    assert.ok(first.body.data.message.edited_at);
    assert.equal((await live).content, 'See you at 6');
    await patch(A, `/messages/${original.message_id}`, { content: 'See you at 6:30' });

    const rows = await h.sql('select old_content from message_edits_t where message_id = ? order by message_edit_id', [original.message_id]);
    assert.deepEqual(rows.map((r) => h.decryptText(r.old_content)), ['See you at 5', 'See you at 6'], 'earlier versions are kept, encrypted');
    const versions = (await as(A).get(`/messages/${original.message_id}/edits`)).body.data.versions;
    assert.deepEqual(versions.map((v) => v.content), ['See you at 5', 'See you at 6', 'See you at 6:30']);
    assert.equal(versions[2].current, true);

    const hist = (await as(B).get(`/conversations/${ab}/messages?limit=10`)).body.data.messages;
    assert.equal(hist.find((m) => m.message_id === reply.message_id).reply_to.content, 'See you at 6:30', 'the quote shows the new text');
    const lastBefore = (await listOf(A)).find((c) => c.conversation_id === ab).last_message;
    if (lastBefore.message_id === original.message_id) assert.equal(lastBefore.content, 'See you at 6:30');
});

test('ED-02 / ED-04 / ED-05 / ED-06 edit rules: server clock window, validation, owner only, not deleted', async () => {
    const old = await send(sA, ab, 'old news');
    await h.sql('update messages_lst_t set created_at = created_at - interval 16 minute where message_id = ?', [old.message_id]);
    const late = await patch(A, `/messages/${old.message_id}`, { content: 'fresh news' });
    assert.equal(late.status, 403);
    assert.equal(late.body.statusKey, 'EDIT_WINDOW_EXPIRED');

    const msg = await send(sA, ab, 'typo heer');
    assert.equal((await patch(A, `/messages/${msg.message_id}`, { content: '   ' })).status, 400);
    assert.equal((await patch(A, `/messages/${msg.message_id}`, { content: 'x'.repeat(9000) })).status, 400, 'beyond the encrypted size of 2000 characters');
    const same = await patch(A, `/messages/${msg.message_id}`, { content: 'typo heer' });
    assert.equal(same.body.data.changed, false);
    assert.equal((await h.sql('select count(*) n from message_edits_t where message_id = ?', [msg.message_id]))[0].n, 0, 'no history row for an unchanged edit');

    const notMine = await patch(B, `/messages/${msg.message_id}`, { content: 'hijack' });
    assert.equal(notMine.status, 403);
    assert.equal((await as(B).get(`/messages/${msg.message_id}/edits`)).status, 403);

    await as(A).del(`/messages/${msg.message_id}`);
    const deleted = await patch(A, `/messages/${msg.message_id}`, { content: 'too late' });
    assert.equal(deleted.status, 403);
    assert.equal((await patch(A, '/messages/999999999', { content: 'ghost' })).status, 404);
});

// ---------------------------------------------------------------- reply
test('RP-03 / RP-05 / RP-08 replies quote a message of the same chat; a deleted original shows as deleted', async () => {
    const original = await send(sB, ab, 'what time?');
    const live = h.waitFor(sB, 'message:new', (m) => m.reply_to?.message_id === original.message_id);
    const reply = await send(sA, ab, 'at six', { reply_to_message_id: original.message_id });
    const { key_version: quoteKey, enc_format: quoteFormat, ...quote } = reply.reply_to;
    assert.deepEqual(quote, { message_id: original.message_id, sender_id: B.user.user_id, sender_name: 'Bob', content: 'what time?', is_deleted: false });
    assert.equal(quoteFormat, 1, 'the quoted text is encrypted too, with its own key version');
    assert.ok(quoteKey >= 1);
    await live;

    await as(B).del(`/messages/${original.message_id}`);
    const hist = (await as(A).get(`/conversations/${ab}/messages?limit=10`)).body.data.messages;
    const quoted = hist.find((m) => m.message_id === reply.message_id).reply_to;
    assert.equal(quoted.is_deleted, true);
    assert.equal(quoted.content, null, 'the deleted text never leaves the server');

    const other = await send(sA, ac, 'in the other chat');
    const cross = await h.emitWithAck(sA, 'message:send', { conversation_id: ab, content: 'sneaky', reply_to_message_id: other.message_id });
    assert.equal(cross.ok, false);
    assert.equal(cross.error.statusKey, 'VALIDATION_ERROR');
    const toDeleted = await h.emitWithAck(sA, 'message:send', { conversation_id: ab, content: 'late reply', reply_to_message_id: original.message_id });
    assert.equal(toDeleted.ok, false);
});

// ---------------------------------------------------------------- forward
test('FW-02 / FW-05 / FW-07 forwarding creates independent copies labelled forwarded, without the source', async () => {
    const source = await send(sB, ab, 'meme of the day');
    const res = await as(A).post(`/messages/${source.message_id}/forward`, { conversation_ids: [ac, ac, ab] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.sent, 2, 'duplicates are sent once');
    const copy = res.body.data.results.find((r) => r.conversation_id === ac).message;
    assert.equal(copy.sender_id, A.user.user_id);
    assert.equal(copy.content, 'meme of the day');
    assert.equal(copy.is_forwarded, true);
    assert.equal(copy.forwarded_from_message_id, undefined, 'the source id is not exposed');
    const stored = await h.sql('select forwarded_from_message_id from messages_lst_t where message_id = ?', [copy.message_id]);
    assert.equal(stored[0].forwarded_from_message_id, source.message_id);

    await as(B).del(`/messages/${source.message_id}`);
    const cHist = (await as(C).get(`/conversations/${ac}/messages?limit=5`)).body.data.messages;
    assert.equal(cHist.find((m) => m.message_id === copy.message_id).content, 'meme of the day', 'the copy survives the original');
});

test('FW-03 / FW-04 / FW-06 forwarding rules: blocked targets fail alone, deleted and foreign sources are refused', async () => {
    const source = await send(sA, ab, 'pass it on');
    await as(C).post(`/users/${A.user.user_id}/block`);
    const res = await as(A).post(`/messages/${source.message_id}/forward`, { conversation_ids: [ac, ab] });
    assert.equal(res.body.data.sent, 1);
    assert.equal(res.body.data.results.find((r) => r.conversation_id === ac).error.statusKey, 'BLOCKED');
    await as(C).del(`/users/${A.user.user_id}/block`);

    assert.equal((await as(A).post(`/messages/${source.message_id}/forward`, { conversation_ids: [] })).status, 400);
    assert.equal((await as(A).post(`/messages/${source.message_id}/forward`, { conversation_ids: Array.from({ length: 11 }, (_, i) => i + 1) })).status, 400);
    const foreign = await as(C).post(`/messages/${source.message_id}/forward`, { conversation_ids: [ac] });
    assert.equal(foreign.status, 404, "a message from someone else's chat looks missing");
    await as(A).del(`/messages/${source.message_id}`);
    assert.equal((await as(A).post(`/messages/${source.message_id}/forward`, { conversation_ids: [ac] })).status, 400);
});

// ---------------------------------------------------------------- scheduled messages
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

test('SC-01 / SC-03 / SC-10 scheduling validates time, text and membership', async () => {
    const ok = await as(A).post(`/conversations/${ab}/scheduled`, { content: 'happy birthday!', send_at: inMinutes(10) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.scheduled.status, 'PENDING');
    const list = await as(A).get(`/conversations/${ab}/scheduled`);
    assert.ok(list.body.data.scheduled.some((s) => s.scheduled_message_id === ok.body.data.scheduled.scheduled_message_id));
    assert.equal((await as(B).get(`/conversations/${ab}/scheduled`)).body.data.scheduled.length, 0, "B never sees A's scheduled messages");

    const past = await as(A).post(`/conversations/${ab}/scheduled`, { content: 'x', send_at: inMinutes(-5) });
    assert.equal(past.status, 400);
    assert.equal((await as(A).post(`/conversations/${ab}/scheduled`, { content: 'x', send_at: inMinutes(0.5) })).status, 400);
    assert.equal((await as(A).post(`/conversations/${ab}/scheduled`, { content: 'x', send_at: 'tomorrow' })).status, 400);
    assert.equal((await as(A).post(`/conversations/${ab}/scheduled`, { content: '', send_at: inMinutes(10) })).status, 400);
    assert.equal((await as(C).post(`/conversations/${ab}/scheduled`, { content: 'x', send_at: inMinutes(10) })).status, 403);
});

test('SC-02 / SC-04 / SC-05 / SC-08 a due message is sent once through the normal path; edit and cancel before', async () => {
    const created = (await as(A).post(`/conversations/${ab}/scheduled`, { content: 'draft', send_at: inMinutes(5) })).body.data.scheduled;
    const id = created.scheduled_message_id;
    const edited = await patch(A, `/scheduled/${id}`, { content: 'final text', send_at: inMinutes(6) });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.scheduled.content, 'final text');
    assert.equal((await patch(B, `/scheduled/${id}`, { content: 'hijack' })).status, 404, "someone else's scheduled message looks missing");

    const doomed = (await as(A).post(`/conversations/${ab}/scheduled`, { content: 'never mind', send_at: inMinutes(5) })).body.data.scheduled;
    assert.equal((await as(A).del(`/scheduled/${doomed.scheduled_message_id}`)).status, 200);

    // make both due by moving their time back, then run the job twice (as two overlapping runs would)
    await h.sql('update scheduled_messages_t set send_at = now(3) - interval 1 second where scheduled_message_id in (?, ?)', [id, doomed.scheduled_message_id]);
    const scheduledService = require('../server/services/scheduledService');
    const incoming = h.waitFor(sB, 'message:new', (m) => m.content === 'final text');
    const [r1, r2] = await Promise.all([scheduledService.runDueSrvc(), scheduledService.runDueSrvc()]);
    assert.equal(r1.sent + r2.sent, 1, 'sent exactly once');
    const message = await incoming;
    assert.equal(message.sender_id, A.user.user_id);

    const [row] = await h.sql('select status, sent_message_id from scheduled_messages_t where scheduled_message_id = ?', [id]);
    assert.equal(row.status, 'SENT');
    assert.equal(row.sent_message_id, message.message_id);
    const [cancelled] = await h.sql('select status from scheduled_messages_t where scheduled_message_id = ?', [doomed.scheduled_message_id]);
    assert.equal(cancelled.status, 'CANCELLED', 'a cancelled message is never sent');
    assert.equal((await patch(A, `/scheduled/${id}`, { content: 'too late' })).status, 400, 'a sent message cannot change');

    await scheduledService.runDueSrvc();
    const copies = await h.sql('select count(*) n from messages_lst_t where conversation_id = ? and content = ?', [ab, h.encryptText('final text')]);
    assert.equal(copies[0].n, 1, 'a later run does not send it again');
});

test('SC-06 a scheduled message to someone who blocked the sender fails with the reason', async () => {
    const s = (await as(B).post(`/conversations/${ab}/scheduled`, { content: 'are you there?', send_at: inMinutes(5) })).body.data.scheduled;
    await as(A).post(`/users/${B.user.user_id}/block`);
    await h.sql('update scheduled_messages_t set send_at = now(3) - interval 1 second where scheduled_message_id = ?', [s.scheduled_message_id]);
    await require('../server/services/scheduledService').runDueSrvc();
    const [row] = await h.sql('select status, failure_reason from scheduled_messages_t where scheduled_message_id = ?', [s.scheduled_message_id]);
    assert.equal(row.status, 'FAILED');
    assert.match(row.failure_reason, /cannot send/i);
    await as(A).del(`/users/${B.user.user_id}/block`);
});
