/*
 * Integration tests for end-to-end encryption: what the server keeps (padlocks and locked boxes only),
 * the four account cases (password changed, password forgotten, app data cleared, a second phone),
 * chat key versions (first key, members leaving and joining, races) and the key check on every send.
 * The server never sees real keys, so the keys here are well-formed stand-ins; the cryptography itself
 * runs in the app. Real server, real database, real sockets.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, C, ab;
const as = (u) => h.api(app.baseUrl, u.token);
const raw = (u, method, path, body) => h.rawCall(app.baseUrl, u?.token, method, path, body);
const id = (u) => u.user.user_id;
const b64 = (n, seed = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 7) % 256)).toString('base64');

// a verified password otp, as the email flow leaves it (no mail is sent in the test run)
const verifiedOtp = async (email, usedFor) => {
    const result = await h.sql(
        `insert into email_audit_logs_t (recipient_email, email_subject, email_status, expires_at, verify_key, is_used, used_for)
            values (?, 'test otp', 'SUCCESS', now() + interval 5 minute, '123456', 1, ?)`, [email, usedFor]);
    return result.insertId;
};
const keysOf = async (u) => (await h.sql('select * from user_keys_t where user_id = ?', [id(u)]))[0];
const convKeys = async (conversationId) => h.sql('select key_version, user_id from conversation_keys_t where conversation_id = ? order by key_version, user_id', [conversationId]);
const convState = async (conversationId) => (await h.sql('select current_key_version, needs_new_key from conversations_lst_t where conversation_id = ?', [conversationId]))[0];
const copiesFor = async (conversationId) => (await raw(A, 'GET', `/conversations/${conversationId}/keys`)).body.data.members
    .filter((m) => m.public_key).map((m) => ({ user_id: m.user_id, user_key_version: m.key_version, locked_key: b64(104, m.user_id) }));

before(async () => {
    app = await h.start();
    [A, B, C] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob'), h.createUser(app.baseUrl, 'Carol')]);
    ab = (await as(A).post('/conversations', { user_id: id(B) })).body.data.conversation.conversation_id;
});

after(async () => {
    await h.cleanupUsers([A, B, C].filter(Boolean).map(id));
    await h.stop(app);
});

test('E2-01 sign-up needs keys; sign-in hands back the locked backups; the recovery code is never stored', async () => {
    const email = `it_${Date.now()}_nokeys@test.local`;
    const noKeys = await raw(null, 'POST', '/auth/signup', { email, password: 'Integration@123', fst_nm: 'Nokeys', date_of_birth: '1995-05-15' });
    assert.equal(noKeys.status, 400, 'an old app without keys cannot register');
    assert.equal((await h.sql('select count(*) n from users_lst_t where user_nm = ?', [email]))[0].n, 0);

    const badKeys = await raw(null, 'POST', '/auth/signup', { email, password: 'Integration@123', fst_nm: 'Badkeys', date_of_birth: '1995-05-15', keys: { ...h.fakeKeySet(), public_key: 'not base64!' } });
    assert.equal(badKeys.status, 400);

    assert.ok(A.keys, 'sign-in returns the keys');
    assert.equal(A.keys.key_version, 1);
    assert.equal(A.keys.pw_backup_valid, true);
    for (const field of ['public_key', 'pw_locked_private_key', 'pw_kdf_salt', 'pw_kdf_params', 'rc_locked_private_key', 'rc_kdf_salt']) assert.ok(A.keys[field], field);
    const mine = await as(A).get('/keys/me');
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.keys.public_key, A.keys.public_key);

    const stored = await keysOf(A);
    assert.ok(!Object.values(stored).some((v) => String(v).includes(h.fakeKeySet().recovery_code)), 'the recovery code is not in the keys row');
    const mails = await h.sql('select email_body from email_audit_logs_t where recipient_email = ? and used_for = ?', [A.email, 'recovery-code']);
    for (const mail of mails) assert.ok(!mail.email_body.includes(h.fakeKeySet().recovery_code), 'the email log masks the code');
});

test('E2-02 padlocks are public; locked chat keys only reach their member', async () => {
    const locks = await as(C).get(`/keys/users?ids=${id(A)},${id(B)}`);
    assert.equal(locks.status, 200);
    assert.deepEqual(locks.body.data.keys.map((k) => k.user_id).sort((x, y) => x - y), [id(A), id(B)].sort((x, y) => x - y));
    assert.ok(locks.body.data.keys.every((k) => !('pw_locked_private_key' in k)), 'only the padlock, never a backup');
    assert.equal((await as(C).get('/keys/users?ids=')).status, 400);

    await as(A).post('/messages', { conversation_id: ab, content: 'hello Bob' });
    const bobs = await as(B).get(`/keys/conversations?conversation_id=${ab}`);
    assert.equal(bobs.status, 200);
    assert.equal(bobs.body.data.keys.length, 1);
    assert.equal(bobs.body.data.keys[0].key_version, 1);
    assert.equal((await as(C).get(`/keys/conversations?conversation_id=${ab}`)).status, 403, 'not their chat');
    assert.equal((await as(C).get(`/conversations/${ab}/keys`)).status, 403);
});

test('E2-03 a send must use the current key; a first message makes version 1 for both members', async () => {
    const ac = (await as(A).post('/conversations', { user_id: id(C) })).body.data.conversation.conversation_id;
    const noKeyYet = await raw(A, 'POST', '/messages', { conversation_id: ac, content: h.encryptText('hi'), key_version: 1 });
    assert.equal(noKeyYet.status, 409);
    assert.equal(noKeyYet.body.statusKey, 'KEY_OUTDATED', 'the chat has no key yet: make it first');

    const state = await as(A).get(`/conversations/${ac}/keys`);
    assert.equal(state.body.data.current_key_version, 0);
    assert.equal(state.body.data.members.length, 2);

    const partial = await raw(A, 'POST', `/conversations/${ac}/keys`, { key_version: 1, copies: [{ user_id: id(A), user_key_version: 1, locked_key: b64(104) }] });
    assert.equal(partial.status, 409, 'a copy for every member, or nothing');
    const skipped = await raw(A, 'POST', `/conversations/${ac}/keys`, { key_version: 2, copies: await copiesFor(ac) });
    assert.equal(skipped.status, 409, 'versions go up one at a time');
    const made = await raw(A, 'POST', `/conversations/${ac}/keys`, { key_version: 1, copies: await copiesFor(ac) });
    assert.equal(made.status, 201);
    assert.deepEqual((await convKeys(ac)).map((k) => k.key_version), [1, 1]);

    const sent = await raw(A, 'POST', '/messages', { conversation_id: ac, content: h.encryptText('hi'), key_version: 1 });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.message.key_version, 1);
    assert.equal(sent.body.data.message.enc_format, 1);
    const plain = await raw(A, 'POST', '/messages', { conversation_id: ac, content: 'plain text, not encrypted', key_version: 1 });
    assert.equal(plain.status, 400, 'only encrypted (base64) text is accepted');
    const stale = await raw(A, 'POST', '/messages', { conversation_id: ac, content: h.encryptText('hi'), key_version: 2 });
    assert.equal(stale.body.statusKey, 'KEY_OUTDATED');
});

test('E2-04 two phones making the same key version at once: one wins, the other is told to fetch it', async () => {
    const bc = (await as(B).post('/conversations', { user_id: id(C) })).body.data.conversation.conversation_id;
    const copies = await (async () => (await raw(B, 'GET', `/conversations/${bc}/keys`)).body.data.members
        .map((m) => ({ user_id: m.user_id, user_key_version: m.key_version, locked_key: b64(104, m.user_id) })))();
    const [one, two] = await Promise.all([
        raw(B, 'POST', `/conversations/${bc}/keys`, { key_version: 1, copies }),
        raw(C, 'POST', `/conversations/${bc}/keys`, { key_version: 1, copies }),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [201, 409]);
    assert.equal((await convKeys(bc)).length, 2, 'exactly one set of copies');
});

test('E2-05 groups: leaving, removal and adding all call for a new key; the next sender makes it', async () => {
    const group = (await as(A).post('/conversations/groups', { title: 'Trip', member_ids: [id(B), id(C)] })).body.data.conversation.conversation_id;
    await as(A).post('/messages', { conversation_id: group, content: 'v1 for three' });
    assert.deepEqual(await convState(group), { current_key_version: 1, needs_new_key: 0 });
    assert.equal((await convKeys(group)).length, 3);

    await as(C).post(`/conversations/${group}/leave`);
    assert.equal((await convState(group)).needs_new_key, 1, 'Carol left: a new key is due');
    const refused = await raw(A, 'POST', '/messages', { conversation_id: group, content: h.encryptText('secret'), key_version: 1 });
    assert.equal(refused.body.statusKey, 'KEY_OUTDATED', 'nothing more goes out under the key Carol has');
    const sent = await as(B).post('/messages', { conversation_id: group, content: 'v2 without Carol' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.message.key_version, 2);
    const v2 = (await convKeys(group)).filter((k) => k.key_version === 2).map((k) => k.user_id).sort((x, y) => x - y);
    assert.deepEqual(v2, [id(A), id(B)].sort((x, y) => x - y), 'Carol gets no copy of version 2');
    assert.equal((await as(C).get(`/keys/conversations?conversation_id=${group}`)).body.data.keys.length, 1, 'she keeps only version 1');

    await as(A).post(`/conversations/${group}/members`, { user_ids: [id(C)] });
    assert.equal((await convState(group)).needs_new_key, 1, 'Carol is back: a new key that includes her');
    await as(A).post('/messages', { conversation_id: group, content: 'v3 for three' });
    assert.equal((await convKeys(group)).filter((k) => k.key_version === 3).length, 3);
});

test('E2-06 case 1: a password change re-locks the backup in the same step; the keys stay', async () => {
    const otpKey = await verifiedOtp(A.email, 'reset-password');
    const backup = { key_version: 1, public_key: A.keys.public_key, pw_locked_private_key: b64(72, 3), pw_kdf_salt: b64(16, 3), pw_kdf_params: 'n=16384,r=8,p=1' };
    const res = await raw(null, 'POST', '/auth/update-password', { email: A.email, newPassword: 'Changed@1234', usedFor: 'reset-password', otpKey, key_backup: backup });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data[0].key_backup_updated, true);
    const row = await keysOf(A);
    assert.equal(row.pw_locked_private_key, backup.pw_locked_private_key);
    assert.equal(row.pw_backup_valid, 1);
    assert.equal(row.public_key, A.keys.public_key, 'same padlock: every chat stays readable');
    const login = await raw(null, 'POST', '/auth/login', { email: A.email, password: 'Changed@1234' });
    assert.equal(login.body.data.keys.pw_locked_private_key, backup.pw_locked_private_key, 'the next sign-in gets the new backup');
    A.password = 'Changed@1234';
});

test('E2-07 case 2: a forgotten password reset without the key marks the backup out of date; recovery fixes it', async () => {
    const otpKey = await verifiedOtp(B.email, 'forgot-password');
    const res = await raw(null, 'POST', '/auth/update-password', { email: B.email, newPassword: 'Forgot@1234', usedFor: 'forgot-password', otpKey });
    assert.equal(res.status, 200);
    assert.equal(res.body.data[0].key_backup_updated, false);
    assert.equal((await keysOf(B)).pw_backup_valid, 0);

    const login = await raw(null, 'POST', '/auth/login', { email: B.email, password: 'Forgot@1234' });
    assert.equal(login.body.data.keys.pw_backup_valid, false, 'the app asks for the recovery code');
    assert.ok(login.body.data.keys.rc_locked_private_key, 'and has the recovery backup to open with it');
    const token = (login.headers.get('access-token') || '').replace(/^Bearer /, '');

    const wrongKeys = await raw({ token }, 'PATCH', '/keys/me/password-backup', { key_version: 1, public_key: b64(32, 9), pw_locked_private_key: b64(72, 5), pw_kdf_salt: b64(16, 5), pw_kdf_params: 'n=16384,r=8,p=1' });
    assert.equal(wrongKeys.status, 409, 'a backup of some other padlock is refused');
    const fixed = await raw({ token }, 'PATCH', '/keys/me/password-backup', { key_version: 1, public_key: B.keys.public_key, pw_locked_private_key: b64(72, 5), pw_kdf_salt: b64(16, 5), pw_kdf_params: 'n=16384,r=8,p=1' });
    assert.equal(fixed.status, 200);
    assert.equal((await keysOf(B)).pw_backup_valid, 1);
    B.token = token;
});

test('E2-08 cases 3 and 4: cleared app data or another phone sign in and get the same keys back', async () => {
    const phone1 = await raw(null, 'POST', '/auth/login', { email: C.email, password: C.password });
    const phone2 = await raw(null, 'POST', '/auth/login', { email: C.email, password: C.password });
    assert.deepEqual(phone1.body.data.keys, phone2.body.data.keys, 'the same padlock and backups on every phone');
    assert.equal(phone2.body.data.keys.public_key, C.keys.public_key);
});

test('E2-09 start fresh: a new padlock, and every chat of that user needs a new key', async () => {
    const before = await convState(ab);
    assert.ok(before.current_key_version >= 1);
    const fresh = { ...h.fakeKeySet(), public_key: b64(32, 11), recovery_code: 'QRST-UVWX-ABCD-EFGH-IJKL-MNOP' };
    const res = await raw(A, 'PUT', '/keys/me', fresh);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.keys.key_version, 2);
    assert.equal(res.body.data.keys.public_key, fresh.public_key);
    assert.equal((await convState(ab)).needs_new_key, 1, "Alice's chats need a key her new padlock opens");
    const next = await as(B).post('/messages', { conversation_id: ab, content: 'after start fresh' });
    assert.equal(next.status, 201);
    const latest = (await convKeys(ab)).filter((k) => k.key_version === next.body.data.message.key_version);
    assert.equal(latest.length, 2);
    const alice = await h.sql('select user_key_version from conversation_keys_t where conversation_id = ? and key_version = ? and user_id = ?', [ab, next.body.data.message.key_version, id(A)]);
    assert.equal(alice[0].user_key_version, 2, 'locked with her new padlock');
});

test('E2-10 a new recovery code replaces the old recovery backup, only for the current keys', async () => {
    const mine = (await as(A).get('/keys/me')).body.data.keys;
    const stale = await raw(A, 'PUT', '/keys/me/recovery', { key_version: 1, public_key: mine.public_key, rc_locked_private_key: b64(72, 13), rc_kdf_salt: b64(16, 13), recovery_code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD' });
    assert.equal(stale.status, 409);
    const ok = await raw(A, 'PUT', '/keys/me/recovery', { key_version: mine.key_version, public_key: mine.public_key, rc_locked_private_key: b64(72, 13), rc_kdf_salt: b64(16, 13), recovery_code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD' });
    assert.equal(ok.status, 200);
    assert.equal((await keysOf(A)).rc_locked_private_key, b64(72, 13));
    assert.equal((await raw(A, 'PUT', '/keys/me/recovery', { key_version: mine.key_version, public_key: mine.public_key, rc_locked_private_key: b64(72, 13), rc_kdf_salt: b64(16, 13), recovery_code: 'short' })).status, 400);
});
