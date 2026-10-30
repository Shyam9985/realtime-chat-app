/*
 * Integration tests for group chats (documents/testing/test-cases-v3.md): creating groups, admin-only
 * management with several admins, exiting (any member), read-only access after leaving, who sees which
 * messages, group ticks, the member limit and concurrent admin actions. Real server, real database,
 * real sockets; ids in the test names point at the test-case document.
 */
process.env.GROUP_MAX_MEMBERS = '5';          // small, so the limit is quick to reach
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app, A, B, C, D, E, F, G, sA, sB, sC, sD;
let trip;                                       // the main group: Alice (admin), Bob, Carol
const ids = {};                                 // message ids the later tests refer to
const sockets = [];
const track = (s) => { sockets.push(s); return s; };
const as = (u) => h.api(app.baseUrl, u.token);
const call = (u, method, path, body) => h.request(app.baseUrl, u.token, method, path, body);
const id = (u) => u.user.user_id;
// these tests create many groups as one user in quick succession: past the per-user creation limit the
// server says how long to wait (Retry-After), and this waits that long and tries again, as the app should
const createGroup = async (u, title, members, extra = {}) => {
    for (;;) {
        const res = await as(u).post('/conversations/groups', { title, member_ids: members.map(id), ...extra });
        if (res.status !== 429) return res;
        await h.sleep((Number(res.headers.get('retry-after')) || 2) * 1000);
    }
};
const summaryOf = async (u, conversationId) => (await as(u).get('/conversations')).body.data.conversations.find((c) => c.conversation_id === conversationId);
const historyOf = async (u, conversationId) => (await as(u).get(`/conversations/${conversationId}/messages?limit=100`)).body.data.messages;
const send = async (socket, conversation_id, content, extra = {}) => {
    const ack = await h.emitWithAck(socket, 'message:send', { conversation_id, content, ...extra });
    assert.equal(ack.ok, true, JSON.stringify(ack.error));
    return ack.message;
};
// resolves true when no matching event arrives within ms
const quiet = (socket, event, predicate, ms = 400) => h.waitFor(socket, event, predicate, ms).then(() => false, () => true);

before(async () => {
    app = await h.start();
    [A, B, C, D, E, F, G] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Fay', 'Gus'].map((n) => h.createUser(app.baseUrl, n)));
    [sA, sB, sC, sD] = await Promise.all([A, B, C, D].map((u) => h.connectSocket(app.baseUrl, u.token).then(track)));
});

after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await h.cleanupUsers([A, B, C, D, E, F, G].filter(Boolean).map(id));
    await h.stop(app);
});

// ---------------------------------------------------------------- creating
test('GR-01 / GR-02 a group starts with its creator as admin, its members, and a created notice', async () => {
    const heard = h.waitFor(sB, 'conversation:new');
    const res = await createGroup(A, '  Trip  ', [B, C], { description: 'Goa, December' });
    assert.equal(res.status, 201);
    const g = res.body.data.conversation;
    trip = g.conversation_id;
    assert.equal(g.conversation_type, 'GROUP');
    assert.equal(g.title, 'Trip', 'the name is trimmed');
    assert.equal(g.description, 'Goa, December');
    assert.equal(g.member_count, 3);
    assert.equal(g.my_role, 'ADMIN');
    assert.equal(g.is_member, true);
    assert.equal((await heard).conversation_id, trip, 'members hear about the new group live');

    const forBob = await summaryOf(B, trip);
    assert.equal(forBob.my_role, 'MEMBER');
    assert.equal(forBob.unread_count, 0, 'notices never count as unread');
    assert.equal(forBob.last_message.system_event, 'GROUP_CREATED');
    const [created] = await historyOf(B, trip);
    assert.equal(created.message_type, 'SYSTEM');
    assert.equal(created.sender_id, id(A));
    assert.equal(created.sender_name, 'Alice');
    assert.equal(created.content, 'Trip');
});

test('GR-03 / GR-04 / GR-05 / GR-06 group creation is validated; blocked and unknown people are skipped', async () => {
    assert.equal((await createGroup(A, '', [B])).status, 400, 'a name is required');
    assert.equal((await createGroup(A, 'x'.repeat(101), [B])).status, 400);
    assert.equal((await as(A).post('/conversations/groups', { title: 'Empty', member_ids: [] })).status, 400);
    assert.equal((await createGroup(A, 'Just me', [A])).status, 400, 'yourself does not count');
    const tooMany = await createGroup(A, 'Crowd', [B, C, D, F, G]);
    assert.equal(tooMany.status, 409, 'creator + 5 is over the limit of 5');
    assert.equal(tooMany.body.statusKey, 'GROUP_FULL');

    assert.equal((await as(E).post(`/users/${id(A)}/block`, {})).status, 200);
    const partly = await as(A).post('/conversations/groups', { title: 'Skip', member_ids: [id(B), id(E), 999999999] });
    assert.equal(partly.status, 201);
    assert.deepEqual(partly.body.data.skipped_user_ids.sort(), [id(E), 999999999].sort(), 'someone who blocked you, and unknown ids, are left out');
    assert.equal(partly.body.data.conversation.member_count, 2);
    assert.equal((await createGroup(A, 'Nobody', [E])).status, 400, 'nobody left to add');
});

// ---------------------------------------------------------------- messages and ticks
test('GR-10 / GR-11 / GR-12 group ticks move only when every member has the message', async () => {
    const bobGets = h.waitFor(sB, 'message:new', (m) => m.content === 'hello all');
    const carolGets = h.waitFor(sC, 'message:new', (m) => m.content === 'hello all');
    const message = await send(sA, trip, 'hello all');
    ids.hello = message.message_id;
    assert.equal((await bobGets).sender_name, 'Alice', 'the sender is named in a group');
    await carolGets;

    const noDelivered = quiet(sA, 'message:delivered', (e) => e.message_id === ids.hello);
    await h.emitWithAck(sB, 'message:delivered', { message_id: ids.hello });
    assert.equal(await noDelivered, true, 'one member having it is not "delivered"');
    const delivered = h.waitFor(sA, 'message:delivered', (e) => e.message_id === ids.hello);
    await h.emitWithAck(sC, 'message:delivered', { message_id: ids.hello });
    await delivered;

    const noSeen = quiet(sA, 'message:seen', (e) => e.message_ids.includes(ids.hello));
    await h.emitWithAck(sB, 'message:seen', { conversation_id: trip });
    assert.equal(await noSeen, true, 'one reader does not turn the ticks blue');
    const seen = h.waitFor(sA, 'message:seen', (e) => e.message_ids.includes(ids.hello));
    await h.emitWithAck(sC, 'message:seen', { conversation_id: trip });
    await seen;
    const [row] = (await historyOf(A, trip)).filter((m) => m.message_id === ids.hello);
    assert.equal(row.status, 'SEEN');
});

// ---------------------------------------------------------------- admins
test('GR-20 / GR-21 only admins add, remove, promote or rename', async () => {
    const tries = [
        await as(B).post(`/conversations/${trip}/members`, { user_ids: [id(D)] }),
        await as(B).del(`/conversations/${trip}/members/${id(C)}`),
        await call(B, 'PATCH', `/conversations/${trip}/group`, { title: 'Mine' }),
        await call(B, 'PATCH', `/conversations/${trip}/members/${id(C)}`, { role: 'ADMIN' }),
    ];
    for (const res of tries) {
        assert.equal(res.status, 403);
        assert.equal(res.body.statusKey, 'NOT_GROUP_ADMIN');
    }
});

test('GR-22 / GR-23 / GR-30 a group can have several admins; a new member sees only what comes after joining', async () => {
    const promoted = await call(A, 'PATCH', `/conversations/${trip}/members/${id(B)}`, { role: 'ADMIN' });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.data.group.members.find((m) => m.user_id === id(B)).role, 'ADMIN');

    const added = await as(B).post(`/conversations/${trip}/members`, { user_ids: [id(D), id(C)] });
    assert.equal(added.status, 200, 'the second admin can add people');
    assert.deepEqual(added.body.data.added_user_ids, [id(D)]);
    assert.deepEqual(added.body.data.already_member_ids, [id(C)]);

    const daveSees = await historyOf(D, trip);
    assert.equal(daveSees.some((m) => m.message_id === ids.hello), false, 'nothing from before Dave joined');
    assert.equal(daveSees[0].system_event, 'MEMBER_ADDED');
    assert.equal(daveSees[0].sender_id, id(B));
    assert.equal(daveSees[0].system_target_user_id, id(D));

    const daveGets = h.waitFor(sD, 'message:new', (m) => m.content === 'welcome dave');
    ids.welcome = (await send(sB, trip, 'welcome dave')).message_id;
    await daveGets;

    // an edit reaches the people who have the message, not someone who joined later
    const carolHears = h.waitFor(sC, 'message:edited', (m) => m.message_id === ids.hello);
    const daveQuiet = quiet(sD, 'message:edited', (m) => m.message_id === ids.hello);
    assert.equal((await call(A, 'PATCH', `/messages/${ids.hello}`, { content: 'hello everyone' })).status, 200);
    await carolHears;
    assert.equal(await daveQuiet, true);
});

test('GR-24 / GR-40 / GR-41 / GR-42 a removed member is read-only and stops receiving', async () => {
    const carolTold = h.waitFor(sC, 'group:updated', (e) => e.conversation_id === trip);
    const removed = await as(B).del(`/conversations/${trip}/members/${id(C)}`);
    assert.equal(removed.status, 200);
    await carolTold;

    const forCarol = await summaryOf(C, trip);
    assert.equal(forCarol.is_member, false, 'the group stays in her list, read-only');
    assert.equal(forCarol.last_message.system_event, 'MEMBER_REMOVED');
    const blocked = await h.emitWithAck(sC, 'message:send', { conversation_id: trip, content: 'can I still?' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.statusKey, 'NOT_A_MEMBER');
    assert.equal((await as(C).get(`/conversations/${trip}/group`)).status, 403, 'no member list after leaving');

    ids.gap = (await send(sA, trip, 'after carol left')).message_id;
    const carolSees = await historyOf(C, trip);
    assert.ok(carolSees.some((m) => m.message_id === ids.hello), 'she keeps what she received');
    assert.equal(carolSees.some((m) => m.message_id === ids.gap), false, 'and gets nothing new');
    assert.equal(carolSees[0].system_event, 'MEMBER_REMOVED', 'the removal is the last thing she sees');
    assert.equal(carolSees[0].system_target_user_id, id(C));
    assert.equal((await summaryOf(C, trip)).last_message.system_event, 'MEMBER_REMOVED', 'her list preview stops moving');
});

// ---------------------------------------------------------------- exiting
test('GR-31 / GR-32 / GR-33 / GR-34 any member can exit; ticks stop waiting for them; their scheduled messages are cancelled', async () => {
    ids.there = (await send(sA, trip, 'are you there?')).message_id;
    await h.emitWithAck(sB, 'message:seen', { conversation_id: trip });          // Bob reads it, Dave does not
    const scheduled = await as(D).post(`/conversations/${trip}/scheduled`, { content: 'later', send_at: new Date(Date.now() + 3600e3).toISOString() });
    assert.equal(scheduled.status, 201);

    const nowSeen = h.waitFor(sA, 'message:seen', (e) => e.message_ids.includes(ids.there));
    const bobHears = h.waitFor(sB, 'message:new', (m) => m.system_event === 'MEMBER_LEFT' && m.sender_id === id(D));
    const exited = await as(D).post(`/conversations/${trip}/leave`, {});
    assert.equal(exited.status, 200, 'a member who is not an admin can exit');
    assert.equal(exited.body.data.conversation.is_member, false);
    await bobHears;
    await nowSeen;      // Dave never read it, but he left: Alice's ticks turn blue

    const [row] = await h.sql('select status, failure_reason from scheduled_messages_t where scheduled_message_id = ?', [scheduled.body.data.scheduled.scheduled_message_id]);
    assert.equal(row.status, 'CANCELLED');
    assert.equal((await as(D).post(`/conversations/${trip}/leave`, {})).status, 403, 'exiting twice is refused');
    assert.equal((await as(D).get(`/conversations/${trip}/messages`)).status, 200, 'he can still read');
});

test('GR-43 / GR-44 / GR-45 after exiting: no forwarding into the group, but out of it; then delete it from the list', async () => {
    const into = await as(D).post(`/messages/${ids.welcome}/forward`, { conversation_ids: [trip] });
    assert.equal(into.status, 200);
    assert.equal(into.body.data.results[0].ok, false, 'not into a group he left');
    const direct = (await as(D).post('/conversations', { user_id: id(A) })).body.data.conversation.conversation_id;
    const out = await as(D).post(`/messages/${ids.welcome}/forward`, { conversation_ids: [direct] });
    assert.equal(out.body.data.results[0].ok, true, 'out of it, into a chat he is in');

    assert.equal((await as(B).del(`/conversations/${trip}`)).status, 400, 'a current member cannot delete the group');
    assert.equal((await as(D).del(`/conversations/${direct}`)).status, 400, 'nor can a one-to-one chat be deleted this way');
    assert.equal((await as(D).del(`/conversations/${trip}`)).status, 200);
    assert.equal(await summaryOf(D, trip), undefined, 'gone from his list');
    assert.equal((await as(D).get(`/conversations/${trip}/messages`)).status, 403);
});

test('GR-25 / GR-26 someone removed can be added back: they see their earlier messages and what comes next, not the gap', async () => {
    const added = await as(A).post(`/conversations/${trip}/members`, { user_ids: [id(C)] });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.data.added_user_ids, [id(C)]);
    const carolGets = h.waitFor(sC, 'message:new', (m) => m.content === 'carol is back');
    ids.back = (await send(sA, trip, 'carol is back')).message_id;
    await carolGets;

    const carolSees = (await historyOf(C, trip)).map((m) => m.message_id);
    assert.ok(carolSees.includes(ids.hello) && carolSees.includes(ids.back));
    assert.equal(carolSees.includes(ids.gap), false, 'nothing sent while she was out');
    const forCarol = await summaryOf(C, trip);
    assert.equal(forCarol.is_member, true);
    assert.equal(forCarol.my_role, 'MEMBER');
});

// ---------------------------------------------------------------- name, description, notices
test('GR-27 / GR-28 / GR-29 admins edit the name and description; the name is the same for everyone', async () => {
    const renamed = await call(A, 'PATCH', `/conversations/${trip}/group`, { title: 'Goa Trip', description: 'Flights on the 20th' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.changed, true);
    assert.equal((await summaryOf(C, trip)).title, 'Goa Trip');
    const notices = (await historyOf(C, trip)).filter((m) => m.message_type === 'SYSTEM').slice(0, 2).map((m) => m.system_event);
    assert.deepEqual(notices.sort(), ['DESCRIPTION_CHANGED', 'NAME_CHANGED']);
    ids.nameNotice = (await historyOf(A, trip)).find((m) => m.system_event === 'NAME_CHANGED').message_id;

    assert.equal((await call(A, 'PATCH', `/conversations/${trip}/group`, { title: 'Goa Trip' })).body.data.changed, false, 'no change, no notice');
    assert.equal((await call(A, 'PATCH', `/conversations/${trip}/group`, { title: '   ' })).status, 400);
    assert.equal((await call(A, 'PATCH', `/conversations/${trip}/group`, {})).status, 400);
    assert.equal((await call(C, 'PATCH', `/conversations/${trip}/settings`, { custom_title: 'My trip' })).status, 400, 'no personal names for groups');
    assert.equal((await call(C, 'PATCH', `/conversations/${trip}/settings`, { is_pinned: true })).status, 200, 'pinning is still personal');
});

test('GR-13 / GR-14 notices cannot be edited, deleted, forwarded or quoted', async () => {
    assert.equal((await call(A, 'PATCH', `/messages/${ids.nameNotice}`, { content: 'hacked' })).status, 403);
    assert.equal((await as(A).del(`/messages/${ids.nameNotice}`)).status, 403);
    assert.equal((await as(A).post(`/messages/${ids.nameNotice}/forward`, { conversation_ids: [trip] })).status, 403);
    const reply = await h.emitWithAck(sB, 'message:send', { conversation_id: trip, content: 'ok', reply_to_message_id: ids.nameNotice });
    assert.equal(reply.ok, false);
});

test('GR-15 / GR-16 message info lists each recipient, for the sender only; history shows only what you can see', async () => {
    const info = await as(A).get(`/messages/${ids.back}/receipts`);
    assert.equal(info.status, 200);
    assert.deepEqual(info.body.data.receipts.map((r) => r.name).sort(), ['Bob', 'Carol']);
    assert.equal((await as(B).get(`/messages/${ids.back}/receipts`)).status, 403);

    const texts = (await historyOf(C, trip)).map((m) => m.content);
    assert.ok(!texts.some((t) => t && t.includes('after carol')), 'not what was sent while she was out');
    assert.ok(texts.some((t) => t && t.includes('hello everyone')));
});

// ---------------------------------------------------------------- the last admin, races, the limit, blocking
test('GR-35 / GR-36 / GR-37 / GR-38 the group always keeps an admin while it has members', async () => {
    const duo = (await createGroup(A, 'Duo', [F])).body.data.conversation.conversation_id;
    const stepDown = await call(A, 'PATCH', `/conversations/${duo}/members/${id(A)}`, { role: 'MEMBER' });
    assert.equal(stepDown.status, 409);
    assert.equal(stepDown.body.statusKey, 'LAST_ADMIN');
    assert.equal((await as(A).del(`/conversations/${duo}/members/${id(A)}`)).status, 400, 'admins exit, they do not remove themselves');

    const exited = await as(A).post(`/conversations/${duo}/leave`, {});
    assert.equal(exited.body.data.promoted_user_id, id(F), 'the longest-standing member takes over');
    const forFay = await summaryOf(F, duo);
    assert.equal(forFay.my_role, 'ADMIN');
    assert.equal(forFay.last_message.system_event, 'ADMIN_ASSIGNED');

    const last = await as(F).post(`/conversations/${duo}/leave`, {});
    assert.equal(last.status, 200, 'the last member can exit too');
    assert.equal(last.body.data.promoted_user_id, null);
    const [{ n }] = await h.sql('select count(*) as n from conversation_members_t where conversation_id = ? and left_at is null', [duo]);
    assert.equal(Number(n), 0);
});

test('GR-39 two admins removing each other at the same moment: exactly one succeeds', async () => {
    const race = (await createGroup(A, 'Race', [B])).body.data.conversation.conversation_id;
    await call(A, 'PATCH', `/conversations/${race}/members/${id(B)}`, { role: 'ADMIN' });
    const results = await Promise.all([as(A).del(`/conversations/${race}/members/${id(B)}`), as(B).del(`/conversations/${race}/members/${id(A)}`)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
    const left = await h.sql('select user_id, member_role from conversation_members_t where conversation_id = ? and left_at is null', [race]);
    assert.equal(left.length, 1);
    assert.equal(left[0].member_role, 'ADMIN');
});

test('GR-07 / GR-08 the member limit holds when adding', async () => {
    const full = (await createGroup(A, 'Full', [B, C, D])).body.data.conversation.conversation_id;
    const over = await as(A).post(`/conversations/${full}/members`, { user_ids: [id(F), id(G)] });
    assert.equal(over.status, 409);
    assert.match(over.body.error, /room for 1 more person/);
    assert.equal((await as(A).post(`/conversations/${full}/members`, { user_ids: [id(F)] })).status, 200);
    assert.equal((await as(A).post(`/conversations/${full}/members`, { user_ids: [id(G)] })).status, 409);
});

test('GR-17 / GR-18 inside a group, someone who blocked a member neither receives nor sees their messages', async () => {
    const blocky = (await createGroup(A, 'Blocky', [B, F])).body.data.conversation.conversation_id;
    assert.equal((await as(B).post(`/users/${id(A)}/block`, {})).status, 200);
    const bobQuiet = quiet(sB, 'message:new', (m) => m.content === 'from alice');
    const fromAlice = await send(sA, blocky, 'from alice');
    assert.equal(await bobQuiet, true);
    assert.equal((await historyOf(B, blocky)).some((m) => m.message_id === fromAlice.message_id), false);
    assert.equal((await summaryOf(B, blocky)).last_message.system_event, 'GROUP_CREATED', 'not even as a preview');
    assert.ok((await historyOf(F, blocky)).some((m) => m.message_id === fromAlice.message_id));
    const fromBob = await send(sB, blocky, 'from bob');
    assert.ok((await historyOf(A, blocky)).some((m) => m.message_id === fromBob.message_id), 'blocking is one-way: Alice still gets Bob');
    await as(B).del(`/users/${id(A)}/block`);
});
