/*
 * Integration tests for the date of birth at sign-up and for editing your own profile
 * (documents/testing/test-cases-v3.md). Real server, real database, real sockets.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, direct;
const extra = [];        // users created by the sign-up tests, removed at the end
const sockets = [];
const as = (u) => h.api(app.baseUrl, u.token);
const patchProfile = (u, body) => fetch(`${app.baseUrl}/apiv1/profile`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'access-token': `Bearer ${u.token}` }, body: JSON.stringify(body)
}).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
const signup = (dob, label = 'dob') => h.api(app.baseUrl).post('/auth/signup', {
    email: `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${label}@test.local`, password: 'Integration@123', fst_nm: 'Dob', keys: h.fakeKeySet(), ...(dob === undefined ? {} : { date_of_birth: dob })
});
const yearsAgo = (years, days = 0) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

before(async () => {
    app = await h.start();
    [A, B] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob')]);
    direct = (await as(A).post('/conversations', { user_id: B.user.user_id })).body.data.conversation.conversation_id;
});

after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    const created = await h.sql("select user_id from users_lst_t where email like 'it\\_%\\_dob@test.local'");
    await h.cleanupUsers([A, B].filter(Boolean).map((u) => u.user.user_id).concat(created.map((r) => r.user_id), extra));
    await h.stop(app);
});

test('BD-01 / BD-02 / BD-03 sign-up asks for a real date of birth, in the past, at least 13 years ago', async () => {
    for (const [dob, why] of [[undefined, 'missing'], ['15-05-1995', 'wrong format'], ['2001-02-30', 'not a real day'], [yearsAgo(-1), 'in the future'],
        [yearsAgo(13, 1), 'one day short of 13'], ['1890-01-01', 'over 120 years']]) {
        const res = await signup(dob);
        assert.equal(res.status, 400, why);
        assert.equal(res.body.statusKey, 'VALIDATION_ERROR', why);
    }
    assert.match((await signup(yearsAgo(10))).body.error, /at least 13 years old/);
    assert.equal((await signup(yearsAgo(13))).status, 201, 'exactly 13 today is allowed');
});

test('BD-04 the profile returns the date of birth exactly as entered', async () => {
    const profile = (await as(A).get('/profile')).body.data;
    assert.equal(profile.date_of_birth, '1995-05-15');
    assert.equal(profile.first_nm, 'Alice');
});

test('PE-01 / PE-02 / PE-03 the user edits their name, mobile and date of birth; blanks clear only the optional ones', async () => {
    const edited = await patchProfile(A, { fst_nm: 'Alicia', lst_nm: 'Rao', mobile: '9876543210', date_of_birth: '1996-01-31' });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.body.data.first_nm, edited.body.data.last_nm, edited.body.data.mobile_no, edited.body.data.date_of_birth], ['Alicia', 'Rao', '9876543210', '1996-01-31']);
    const cleared = await patchProfile(A, { lst_nm: '', mobile: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.last_nm, null);
    assert.equal(cleared.body.data.mobile_no, null);
    assert.equal(cleared.body.data.first_nm, 'Alicia', 'what was not sent is unchanged');

    for (const [body, why] of [[{ fst_nm: '' }, 'first name required'], [{ fst_nm: 'A1' }, 'letters only'], [{ mobile: '12345' }, 'bad mobile'],
        [{ date_of_birth: '' }, 'date of birth required'], [{ date_of_birth: yearsAgo(5) }, 'too young'], [{ email: 'new@test.local' }, 'email is not editable'], [{}, 'nothing to change']]) {
        assert.equal((await patchProfile(A, body)).status, 400, why);
    }
});

test('PE-04 / PE-05 a new name reaches one-to-one chats that still show the old one, live; a chat renamed by the other person keeps its name', async () => {
    // PE-01 already renamed Alice to Alicia (and cleared her last name): Bob's chat followed
    assert.equal((await as(B).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === direct).title, 'Alicia');
    const sB = await h.connectSocket(app.baseUrl, B.token);
    sockets.push(sB);
    const live = h.waitFor(sB, 'conversation:updated', (c) => c.conversation_id === direct);
    await patchProfile(A, { fst_nm: 'Alicia', lst_nm: 'Rao' });
    assert.equal((await live).title, 'Alicia Rao');

    await fetch(`${app.baseUrl}/apiv1/conversations/${direct}/settings`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'access-token': `Bearer ${B.token}` }, body: JSON.stringify({ custom_title: 'Bestie' })
    });
    await patchProfile(A, { fst_nm: 'Ally' });
    assert.equal((await as(B).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === direct).title, 'Bestie');
});
