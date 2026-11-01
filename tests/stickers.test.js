/*
 * Integration tests for stickers: a STICKER message carries the sticker's id as its encrypted content,
 * the server stores only the type (never which sticker), a forwarded sticker stays a sticker, stickers
 * cannot be edited, and anything but TEXT or STICKER is refused. Real server, real database.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, ab, ac, C;
const as = (u) => h.api(app.baseUrl, u.token);

before(async () => {
    app = await h.start();
    [A, B, C] = await Promise.all([h.createUser(app.baseUrl, 'Ann'), h.createUser(app.baseUrl, 'Ben'), h.createUser(app.baseUrl, 'Cal')]);
    ab = (await as(A).post('/conversations', { user_id: B.user.user_id })).body.data.conversation.conversation_id;
    ac = (await as(A).post('/conversations', { user_id: C.user.user_id })).body.data.conversation.conversation_id;
});

after(async () => {
    await h.cleanupUsers([A, B, C].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

test('ST-01 a sticker is a message of type STICKER whose content is the (encrypted) sticker id', async () => {
    const res = await as(A).post('/messages', { conversation_id: ab, content: '1F600', message_type: 'STICKER' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const m = res.body.data.message;
    assert.equal(m.message_type, 'STICKER');
    assert.equal(m.content, '1F600');
    const [row] = await h.sql('select content, message_type_id from messages_lst_t where message_id = ?', [m.message_id]);
    assert.notEqual(row.content, '1F600', 'the server stores the id encrypted, like any text');
    const [type] = await h.sql('select type_code from message_type_master_t where message_type_id = ?', [row.message_type_id]);
    assert.equal(type.type_code, 'STICKER');

    const seen = (await as(B).get(`/conversations/${ab}/messages?limit=5`)).body.data.messages.find((x) => x.message_id === m.message_id);
    assert.equal(seen.message_type, 'STICKER');
    const list = (await as(B).get('/conversations')).body.data.conversations.find((x) => x.conversation_id === ab);
    assert.equal(list.last_message.message_type, 'STICKER', 'the chat list knows it is a sticker (it says "Sticker", never the id)');
});

test('ST-02 a forwarded sticker stays a sticker; a sticker cannot be edited; plain text stays TEXT', async () => {
    const sticker = (await as(A).post('/messages', { conversation_id: ab, content: '1F44D', message_type: 'STICKER' })).body.data.message;
    const fwd = await as(A).post(`/messages/${sticker.message_id}/forward`, { conversation_ids: [ac] });
    assert.equal(fwd.status, 200);
    const copy = fwd.body.data.results[0].message;
    assert.equal(copy.message_type, 'STICKER');
    assert.equal(copy.content, '1F44D');
    assert.equal(copy.is_forwarded, true);

    const edit = await as(A).patch(`/messages/${sticker.message_id}`, { content: '1F600' });
    assert.equal(edit.status, 403, 'stickers are not editable');

    const text = (await as(A).post('/messages', { conversation_id: ab, content: 'just words' })).body.data.message;
    assert.equal(text.message_type, 'TEXT');
    const reply = (await as(B).post('/messages', { conversation_id: ab, content: '1F602', message_type: 'STICKER', reply_to_message_id: text.message_id })).body.data.message;
    assert.equal(reply.reply_to.message_id, text.message_id, 'a sticker can reply to a message');
});

test('ST-03 only TEXT and STICKER may be sent', async () => {
    for (const bad of ['SYSTEM', 'IMAGE', 'sticker', 'x']) {
        const res = await as(A).post('/messages', { conversation_id: ab, content: 'hi', message_type: bad });
        assert.equal(res.status, 400, bad);
    }
});
