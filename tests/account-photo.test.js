/*
 * Integration tests for the group photo (admins set and remove it, members see it, a new one replaces
 * the old completely), deleting an account (everything the user wrote goes; the people around them keep
 * working chats) and sign-in limits counted per email rather than per network. Real server, real
 * database, real files.
 */
const fs = require('fs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const h = require('./helpers/testApp');
const { resolveStoredPath } = require('../server/utils/files.utils');

let app, A, B, C, D, group;
const as = (u) => h.api(app.baseUrl, u.token);
const id = (u) => u.user.user_id;
const png = () => sharp({ create: { width: 300, height: 300, channels: 3, background: '#128C5E' } }).png().toBuffer();
const uploadGroupPhoto = async (u, conversationId, body) => fetch(`${app.baseUrl}/apiv1/conversations/${conversationId}/photo`, {
    method: 'POST', body, headers: { 'access-token': `Bearer ${u.token}`, 'content-type': 'image/png', 'x-file-name': 'group.png' },
}).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
const photoRows = (conversationId) => h.sql("select file_id, file_path, uploaded_by from uploaded_files_lst_t where entity_type = 'GROUP_PHOTO' and entity_id = ?", [conversationId]);
const count = async (query, params) => (await h.sql(query, params))[0].n;

before(async () => {
    app = await h.start();
    [A, B, C, D] = await Promise.all(['Ann', 'Ben', 'Cal', 'Dee'].map((n) => h.createUser(app.baseUrl, n)));
    group = (await as(A).post('/conversations/groups', { title: 'Photo club', member_ids: [id(B), id(C)] })).body.data.conversation.conversation_id;
});

after(async () => {
    await h.cleanupUsers([A, B, C, D].filter(Boolean).map(id));
    await h.stop(app);
});

test('GP-01 only admins set the group photo; it is compressed, replaces the old one and is announced', async () => {
    assert.equal((await uploadGroupPhoto(B, group, await png())).status, 403, 'a member who is not an admin cannot');
    const first = await uploadGroupPhoto(A, group, await png());
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const [row1] = await photoRows(group);
    assert.ok(fs.existsSync(resolveStoredPath(row1.file_path)));
    assert.equal((await sharp(fs.readFileSync(resolveStoredPath(row1.file_path))).metadata()).format, 'jpeg');

    const second = await uploadGroupPhoto(A, group, await png());
    assert.equal(second.status, 200);
    const rows = await photoRows(group);
    assert.equal(rows.length, 1, 'only the newest photo is kept');
    assert.equal(fs.existsSync(resolveStoredPath(row1.file_path)), false, 'the old file is gone from disk');

    const summary = (await as(B).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === group);
    assert.equal(summary.photo_url, rows[0].file_path);
    const history = (await as(B).get(`/conversations/${group}/messages?limit=20`)).body.data.messages;
    assert.ok(history.some((m) => m.system_event === 'PHOTO_CHANGED'), 'members see a notice');

    const seen = await fetch(`${app.baseUrl}/apiv1/conversations/${group}/photo`, { headers: { 'access-token': `Bearer ${C.token}` } });
    assert.equal(seen.status, 200);
    assert.equal(seen.headers.get('content-type'), 'image/jpeg');
    const outsider = await fetch(`${app.baseUrl}/apiv1/conversations/${group}/photo`, { headers: { 'access-token': `Bearer ${D.token}` } });
    assert.equal(outsider.status, 403);
});

test('GP-02 removing the group photo deletes the row and the file; members then get "no photo"', async () => {
    const [row] = await photoRows(group);
    assert.equal((await as(B).del(`/conversations/${group}/photo`)).status, 403);
    assert.equal((await as(A).del(`/conversations/${group}/photo`)).status, 200);
    assert.equal((await photoRows(group)).length, 0);
    assert.equal(fs.existsSync(resolveStoredPath(row.file_path)), false);
    const seen = await fetch(`${app.baseUrl}/apiv1/conversations/${group}/photo`, { headers: { 'access-token': `Bearer ${B.token}` } });
    assert.equal(seen.status, 404);
    assert.equal((await as(A).del(`/conversations/${group}/photo`)).status, 404, 'nothing left to remove');
});

test('DA-01 deleting an account needs the password and removes everything the user wrote', async () => {
    // Ann: a one-to-one chat with Dee, the group she created (with a photo), messages and a profile photo
    const ad = (await as(A).post('/conversations', { user_id: id(D) })).body.data.conversation.conversation_id;
    await as(A).post('/messages', { conversation_id: ad, content: 'hi Dee' });
    await as(D).post('/messages', { conversation_id: ad, content: 'hi Ann' });
    await as(A).post('/messages', { conversation_id: group, content: 'from Ann' });
    const benMessage = (await as(B).post('/messages', { conversation_id: group, content: 'from Ben' })).body.data.message;
    await uploadGroupPhoto(A, group, await png());
    const groupPhoto = (await photoRows(group))[0];
    await fetch(`${app.baseUrl}/apiv1/files/upload`, {
        method: 'POST', body: await png(), headers: { 'access-token': `Bearer ${A.token}`, 'content-type': 'image/png', 'x-file-name': 'me.png' },
    });
    const [profilePhoto] = await h.sql("select file_path from uploaded_files_lst_t where entity_type = 'USER_PROFILE' and entity_id = ?", [id(A)]);

    const wrong = await h.request(app.baseUrl, A.token, 'DELETE', '/profile', { password: 'Not@ThePassword1' });
    assert.equal(wrong.status, 401, 'the password is checked again');
    assert.equal((await h.request(app.baseUrl, A.token, 'DELETE', '/profile', {})).status, 400);

    const done = await h.request(app.baseUrl, A.token, 'DELETE', '/profile', { password: A.password });
    assert.equal(done.status, 200, JSON.stringify(done.body));

    const ann = id(A);
    assert.equal(await count('select count(*) n from users_lst_t where user_id = ?', [ann]), 0);
    for (const [table, column] of [['user_keys_t', 'user_id'], ['user_devices_t', 'user_id'], ['conversation_members_t', 'user_id'],
        ['message_receipts_t', 'user_id'], ['conversation_keys_t', 'user_id'], ['user_sessions_t', 'user_id'], ['messages_lst_t', 'sender_id'],
        ['messages_lst_t', 'system_target_user_id'], ['uploaded_files_lst_t', 'uploaded_by']]) {
        assert.equal(await count(`select count(*) n from ${table} where ${column} = ?`, [ann]), 0, `${table}.${column}`);
    }
    assert.equal(await count('select count(*) n from conversations_lst_t where conversation_id = ?', [ad]), 0, 'the one-to-one chat is gone');
    assert.equal(fs.existsSync(resolveStoredPath(profilePhoto.file_path)), false, 'the profile photo file is gone');

    // the group goes on: Ben is its admin and owner now, keeps his own message, the photo stays, a new key is due
    const [g] = await h.sql('select created_by, needs_new_key, last_message_id from conversations_lst_t where conversation_id = ?', [group]);
    assert.equal(g.created_by, id(B));
    assert.equal(g.needs_new_key, 1);
    assert.equal(g.last_message_id, benMessage.message_id, 'the preview moves to what is left');
    const [benRole] = await h.sql('select member_role from conversation_members_t where conversation_id = ? and user_id = ?', [group, id(B)]);
    assert.equal(benRole.member_role, 'ADMIN');
    const [photo] = await photoRows(group);
    assert.equal(photo.file_id, groupPhoto.file_id, 'the group keeps its photo');
    assert.equal(photo.uploaded_by, id(B));
    const benView = (await as(B).get(`/conversations/${group}/messages?limit=50`)).body.data.messages;
    assert.ok(!benView.some((m) => m.content === 'from Ann'), "Ann's messages are gone for everyone");
    assert.ok(benView.some((m) => m.content === 'from Ben'));
    assert.ok(!(await as(D).get('/conversations')).body.data.conversations.some((c) => c.conversation_id === ad), 'Dee no longer has the chat');
    const sent = await as(B).post('/messages', { conversation_id: group, content: 'still working' });
    assert.equal(sent.status, 201, 'the group keeps working (with a new key)');

    assert.equal((await as(A).get('/profile')).status, 401, 'the old session is dead');
    A = null;
});

test('RL-01 sign-ups are limited per email, so people registering on one network do not block each other', async () => {
    const network = '127.1.0.1';           // one address for every request below, like one home wi-fi
    const signUp = (email) => h.anonymousCall(app.baseUrl, 'POST', '/auth/signup',
        { email, password: 'Integration@123', fst_nm: 'Rate', date_of_birth: '1995-05-15', keys: h.fakeKeySet() }, network);
    const made = [];
    try {
        // five different people from the same address: the old per-ip limit refused the fourth
        for (let i = 0; i < 5; i += 1) {
            const res = await signUp(`it_${Date.now()}_${i}_rl@test.local`);
            assert.equal(res.status, 201, `sign-up ${i + 1}: ${JSON.stringify(res.body)}`);
            made.push(res.body.data.id);
        }
        // one email tried again and again is still limited
        const repeat = `it_${Date.now()}_repeat_rl@test.local`;
        const statuses = [];
        for (let i = 0; i < 4; i += 1) {
            const res = await signUp(repeat);
            statuses.push(res.status);
            if (res.status === 201) made.push(res.body.data.id);
        }
        assert.equal(statuses[3], 429, `the fourth try on one email is limited (${statuses})`);
    } finally {
        await h.cleanupUsers(made);
    }
});
