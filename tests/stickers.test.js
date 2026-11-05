/*
 * Integration tests for stickers. Messages: a STICKER message carries the sticker's id as its encrypted
 * content, the server stores only the type (never which sticker), a forwarded sticker stays a sticker,
 * stickers cannot be edited, and anything but TEXT or STICKER is refused. The store: a pack made of real
 * images (through the same service the import uses), the store listing, a user's drawer and favourites,
 * the image route, the import endpoint's guards, and the Signal pack format helpers. Real server, real
 * database, real bucket.
 */
process.env.RELEASE_PUBLISH_KEY = 'it-release-key-'.padEnd(64, 'k');     // the import endpoint on, with a known key
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const sharp = require('sharp');
const h = require('./helpers/testApp');
const stickersService = require('../server/services/stickersService');
const signal = require('../server/utils/signal.stickers.utils');
const storage = require('../server/utils/storage.utils');

let app, A, B, ab, ac, C, pack;
const as = (u) => h.api(app.baseUrl, u.token);
// keyed like a signal pack, so a user "bringing" it by link finds it already in the store (no network)
const SIGNAL_ID = crypto.randomBytes(16).toString('hex');
const PACK_KEY = `signal:${SIGNAL_ID}`;
const image = (r, g, b, width = 300, height = 200) => sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();

before(async () => {
    app = await h.start();
    [A, B, C] = await Promise.all([h.createUser(app.baseUrl, 'Ann'), h.createUser(app.baseUrl, 'Ben'), h.createUser(app.baseUrl, 'Cal')]);
    ab = (await as(A).post('/conversations', { user_id: B.user.user_id })).body.data.conversation.conversation_id;
    ac = (await as(A).post('/conversations', { user_id: C.user.user_id })).body.data.conversation.conversation_id;
    pack = await stickersService.createPackSrvc({
        packKey: PACK_KEY, title: 'Test pack', author: 'The tests', source: 'TEST', coverIndex: 1,
        stickers: [{ bytes: await image(255, 0, 0), emoji: '😀' }, { bytes: await image(0, 255, 0, 900, 900), emoji: '👍' }, { bytes: await image(0, 0, 255), emoji: null }]
    });
});

after(async () => {
    await h.cleanupUsers([A, B, C].filter(Boolean).map((u) => u.user.user_id));
    if (pack) {
        const paths = await h.sql('select file_path from stickers_t where pack_id = ?', [pack.pack_id]);
        await h.sql('delete from user_favourite_stickers_t where sticker_id in (select sticker_id from stickers_t where pack_id = ?)', [pack.pack_id]);
        await h.sql('delete from user_sticker_packs_t where pack_id = ?', [pack.pack_id]);
        await h.sql('delete from stickers_t where pack_id = ?', [pack.pack_id]);
        await h.sql('delete from sticker_packs_t where pack_id = ?', [pack.pack_id]);
        await storage.remove(paths.map((p) => p.file_path)).catch(() => {});
    }
    await h.stop(app);
});

// ---- messages
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

// ---- the store
test('ST-04 a created pack is in the store with uniform stickers, its cover, and whether the caller has it', async () => {
    assert.equal(pack.sticker_count, 3);
    assert.equal(pack.is_animated, false);
    const store = await as(A).get('/stickers/store');
    assert.equal(store.status, 200, JSON.stringify(store.body));
    const listed = store.body.data.packs.find((p) => p.pack_id === pack.pack_id);
    assert.ok(listed, 'in the store');
    assert.equal(listed.added, false);
    assert.equal(listed.title, 'Test pack');
    assert.equal(listed.author, 'The tests');

    const detail = (await as(A).get(`/stickers/packs/${pack.pack_id}`)).body.data.pack;
    assert.equal(detail.stickers.length, 3);
    assert.deepEqual(detail.stickers.map((s) => s.position), [0, 1, 2]);
    assert.deepEqual(detail.stickers.map((s) => s.emoji), ['😀', '👍', null]);
    assert.equal(detail.cover_sticker_id, detail.stickers[1].sticker_id, 'the cover is the sticker asked for');
    const rows = await h.sql('select file_path, mime_type, size_bytes from stickers_t where pack_id = ? order by position', [pack.pack_id]);
    assert.ok(rows.every((r) => r.mime_type === 'image/webp' && r.file_path === `stickers/${pack.pack_id}/${rows.indexOf(r)}.webp`), JSON.stringify(rows));
    assert.ok(rows.every((r) => r.size_bytes > 0 && r.size_bytes <= 500 * 1024));
    assert.equal(await storage.exists(rows[1].file_path), true, 'the file is in the bucket');

    const missing = await as(A).get('/stickers/packs/999999999');
    assert.equal(missing.status, 404);
});

test('ST-05 a user adds a pack to their drawer (and again, harmlessly), then removes it', async () => {
    const add = await as(A).post(`/stickers/packs/${pack.pack_id}/mine`);
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.deepEqual(add.body.data, { pack_id: pack.pack_id, added: true });
    assert.equal((await as(A).post(`/stickers/packs/${pack.pack_id}/mine`)).status, 201, 'adding twice is fine');

    const drawer = (await as(A).get('/stickers/mine')).body.data;
    const mine = drawer.packs.find((p) => p.pack_id === pack.pack_id);
    assert.ok(mine, 'in the drawer');
    assert.equal(mine.stickers.length, 3, 'with its stickers');
    assert.equal(mine.stickers[1].emoji, '👍');
    assert.equal((await h.sql('select count(*) n from user_sticker_packs_t where user_id = ? and pack_id = ?', [A.user.user_id, pack.pack_id]))[0].n, 1);
    const store = (await as(A).get('/stickers/store')).body.data.packs.find((p) => p.pack_id === pack.pack_id);
    assert.equal(store.added, true);

    const detail = (await as(A).get(`/stickers/packs/${pack.pack_id}`)).body.data.pack;
    assert.equal(detail.added, true);

    const remove = await as(A).del(`/stickers/packs/${pack.pack_id}/mine`);
    assert.equal(remove.status, 200, JSON.stringify(remove.body));
    assert.equal((await as(A).get('/stickers/mine')).body.data.packs.some((p) => p.pack_id === pack.pack_id), false);
    assert.equal((await as(A).post('/stickers/packs/999999999/mine')).status, 404, 'a pack that is not in the store');
});

test('ST-06 a sticker image is served to any signed-in user as WebP within 512 px, and kept for good', async () => {
    const detail = (await as(B).get(`/stickers/packs/${pack.pack_id}`)).body.data.pack;
    const big = detail.stickers[1];        // made from a 900x900 image
    const res = await fetch(`${app.baseUrl}/apiv1/stickers/${big.sticker_id}/image`, { headers: { 'access-token': `Bearer ${B.token}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.match(res.headers.get('cache-control'), /immutable/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(Number(res.headers.get('content-length')), bytes.length);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);

    const small = await sharp(Buffer.from(await (await fetch(`${app.baseUrl}/apiv1/stickers/${detail.stickers[0].sticker_id}/image`, { headers: { 'access-token': `Bearer ${B.token}` } })).arrayBuffer())).metadata();
    assert.equal(small.width, 300, 'small stickers are not enlarged');

    assert.equal((await fetch(`${app.baseUrl}/apiv1/stickers/${big.sticker_id}/image`)).status, 401, 'sign-in needed');
    assert.equal((await fetch(`${app.baseUrl}/apiv1/stickers/999999999/image`, { headers: { 'access-token': `Bearer ${B.token}` } })).status, 404);
});

test('ST-07 favourites: starred stickers come newest first in the drawer, can be removed, must exist', async () => {
    const detail = (await as(B).get(`/stickers/packs/${pack.pack_id}`)).body.data.pack;
    const [s0, s1] = detail.stickers;
    assert.equal((await as(B).put(`/stickers/favourites/${s0.sticker_id}`)).status, 201);
    assert.equal((await as(B).put(`/stickers/favourites/${s1.sticker_id}`)).status, 201);
    assert.equal((await as(B).put(`/stickers/favourites/${s1.sticker_id}`)).status, 201, 'starring twice is fine');
    let drawer = (await as(B).get('/stickers/mine')).body.data;
    assert.deepEqual(drawer.favourites.map((s) => s.sticker_id), [s1.sticker_id, s0.sticker_id]);
    assert.equal(drawer.max_favourites, 100);
    assert.equal(drawer.packs.some((p) => p.pack_id === pack.pack_id), false, 'a favourite does not add the pack');

    assert.equal((await as(B).del(`/stickers/favourites/${s1.sticker_id}`)).status, 200);
    drawer = (await as(B).get('/stickers/mine')).body.data;
    assert.deepEqual(drawer.favourites.map((s) => s.sticker_id), [s0.sticker_id]);
    assert.equal((await as(B).put('/stickers/favourites/999999999')).status, 404);
    assert.equal((await as(B).put('/stickers/favourites/abc')).status, 400);
});

test('ST-08 deleting the account removes the drawer and the favourites', async () => {
    const D = await h.createUser(app.baseUrl, 'Dee');
    const detail = (await as(D).get(`/stickers/packs/${pack.pack_id}`)).body.data.pack;
    await as(D).post(`/stickers/packs/${pack.pack_id}/mine`);
    await as(D).put(`/stickers/favourites/${detail.stickers[0].sticker_id}`);
    const gone = await h.request(app.baseUrl, D.token, 'DELETE', '/profile', { password: D.password });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal((await h.sql('select count(*) n from user_sticker_packs_t where user_id = ?', [D.user.user_id]))[0].n, 0);
    assert.equal((await h.sql('select count(*) n from user_favourite_stickers_t where user_id = ?', [D.user.user_id]))[0].n, 0);
});

test('ST-09 the import endpoint needs the release key and a real pack link; a pack cannot be created twice', async () => {
    const link = 'https://signalstickers.com/pack/0123456789abcdef0123456789abcdef?key=' + 'ab'.repeat(32);
    const noKey = await h.anonymousCall(app.baseUrl, 'POST', '/stickers/import', { link });
    assert.equal(noKey.status, 403);
    const wrongKey = await h.anonymousCall(app.baseUrl, 'POST', '/stickers/import', { link }, undefined, { 'x-release-key': 'nope'.padEnd(64, 'x') });
    assert.equal(wrongKey.status, 403);
    const badLink = await h.anonymousCall(app.baseUrl, 'POST', '/stickers/import', { link: 'https://example.com/not-a-pack' }, undefined, { 'x-release-key': process.env.RELEASE_PUBLISH_KEY });
    assert.equal(badLink.status, 400, JSON.stringify(badLink.body));
    const noLink = await h.anonymousCall(app.baseUrl, 'POST', '/stickers/import', {}, undefined, { 'x-release-key': process.env.RELEASE_PUBLISH_KEY });
    assert.equal(noLink.status, 400);

    await assert.rejects(stickersService.createPackSrvc({ packKey: PACK_KEY, title: 'Again', source: 'TEST', stickers: [{ bytes: await image(1, 2, 3) }] }), (e) => e.name === 'packExists');
    await assert.rejects(stickersService.createPackSrvc({ packKey: `${PACK_KEY}-bad`, title: 'Bad', source: 'TEST', stickers: [{ bytes: Buffer.from('not an image') }] }), (e) => e.name === 'importFailed');
    assert.equal((await h.sql('select count(*) n from sticker_packs_t where pack_key = ?', [`${PACK_KEY}-bad`]))[0].n, 0, 'nothing is left of a refused pack');
});

test('ST-11 a user brings a pack by link: the link is checked; a pack already in the store just joins their drawer', async () => {
    // three tries an hour each, refused links included: Ben spends his on the checks, Cal brings the pack
    assert.equal((await as(B).post('/stickers/packs', {})).status, 400, 'no link');
    assert.equal((await as(B).post('/stickers/packs', { link: 'https://example.com/nothing' })).status, 400, 'not a pack link');
    assert.equal((await as(B).post('/stickers/packs', { link: 'x'.repeat(601) })).status, 400, 'too long');
    assert.equal((await as(B).post('/stickers/packs', { link: 'x'.repeat(601) })).status, 429, 'the fourth try in an hour waits');

    // the store pack, by its signal link (the key is not checked for a pack the server already has)
    const link = `https://signalstickers.com/pack/${SIGNAL_ID}?key=${'ab'.repeat(32)}`;
    const res = await as(C).post('/stickers/packs', { link });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.already, true);
    assert.equal(res.body.data.pack.pack_id, pack.pack_id);
    assert.equal(res.body.data.pack.added, true);
    assert.equal((await as(C).get('/stickers/mine')).body.data.packs.some((p) => p.pack_id === pack.pack_id), true, 'in the drawer');
    assert.equal((await as(C).get('/stickers/store')).body.data.packs.find((p) => p.pack_id === pack.pack_id).added, true);

    // a pack signal does not have: refused with a reason and nothing is created (needs the signal cdn)
    if (process.env.TEST_SIGNAL_IMPORT) {
        const unknown = 'https://signalstickers.com/pack/0123456789abcdef0123456789abcdef?key=' + 'ab'.repeat(32);
        const refused = await as(A).post('/stickers/packs', { link: unknown });
        assert.equal(refused.status, 400, JSON.stringify(refused.body));
        assert.equal((await h.sql('select count(*) n from sticker_packs_t where pack_key = ?', ['signal:0123456789abcdef0123456789abcdef']))[0].n, 0);
    }
    assert.equal((await h.api(app.baseUrl).post('/stickers/packs', { link })).status, 401, 'sign-in needed');
});

test('ST-12 a pack a user brought is theirs alone: in their store and drawer only, while its stickers still reach whoever receives them', async () => {
    const E = await h.createUser(app.baseUrl, 'Eve');
    let own;
    try {
        own = await stickersService.createPackSrvc({
            packKey: `signal:${crypto.randomBytes(16).toString('hex')}:u${E.user.user_id}`, title: 'Eve only', source: 'TEST', ownerUserId: E.user.user_id,
            stickers: [{ bytes: await image(9, 9, 9), emoji: '🙂' }, { bytes: await image(90, 90, 90) }]
        });
        const mineInStore = (await as(E).get('/stickers/store')).body.data.packs.find((p) => p.pack_id === own.pack_id);
        assert.ok(mineInStore, 'the owner sees it in the store');
        assert.equal(mineInStore.is_mine, true);
        assert.equal((await as(E).get('/stickers/store')).body.data.packs[0].pack_id, own.pack_id, 'own packs come first');
        assert.equal((await as(B).get('/stickers/store')).body.data.packs.some((p) => p.pack_id === own.pack_id), false, 'nobody else does');
        assert.equal((await as(B).get(`/stickers/packs/${own.pack_id}`)).status, 404);
        assert.equal((await as(B).post(`/stickers/packs/${own.pack_id}/mine`)).status, 404);
        assert.equal((await as(E).post(`/stickers/packs/${own.pack_id}/mine`)).status, 201);
        const detail = (await as(E).get(`/stickers/packs/${own.pack_id}`)).body.data.pack;
        assert.equal(detail.is_mine, true);
        assert.equal(detail.stickers.length, 2);
        assert.equal((await as(E).get('/stickers/mine')).body.data.packs.some((p) => p.pack_id === own.pack_id), true);

        // Eve sends one of them to Ben: he can see it and keep it, like any sticker
        const sent = detail.stickers[0].sticker_id;
        assert.equal((await fetch(`${app.baseUrl}/apiv1/stickers/${sent}/image`, { headers: { 'access-token': `Bearer ${B.token}` } })).status, 200);
        assert.equal((await as(B).put(`/stickers/favourites/${sent}`)).status, 201);
        assert.equal((await as(B).get('/stickers/mine')).body.data.favourites.some((s) => s.sticker_id === sent), true);

        // Eve deletes her account: the pack belongs to nobody and shows nowhere, but Ben's kept sticker still works
        const gone = await h.request(app.baseUrl, E.token, 'DELETE', '/profile', { password: E.password });
        assert.equal(gone.status, 200, JSON.stringify(gone.body));
        const [row] = await h.sql('select owner_user_id, is_published, is_active from sticker_packs_t where pack_id = ?', [own.pack_id]);
        assert.deepEqual({ owner: row.owner_user_id, published: row.is_published, active: row.is_active }, { owner: null, published: 0, active: 1 });
        assert.equal((await as(B).get('/stickers/store')).body.data.packs.some((p) => p.pack_id === own.pack_id), false, 'unpublished: in no store at all');
        assert.equal((await fetch(`${app.baseUrl}/apiv1/stickers/${sent}/image`, { headers: { 'access-token': `Bearer ${B.token}` } })).status, 200);
    } finally {
        if (own) {
            const paths = await h.sql('select file_path from stickers_t where pack_id = ?', [own.pack_id]);
            await h.sql('delete from user_favourite_stickers_t where sticker_id in (select sticker_id from stickers_t where pack_id = ?)', [own.pack_id]);
            await h.sql('delete from user_sticker_packs_t where pack_id = ?', [own.pack_id]);
            await h.sql('delete from stickers_t where pack_id = ?', [own.pack_id]);
            await h.sql('delete from sticker_packs_t where pack_id = ?', [own.pack_id]);
            await storage.remove(paths.map((p) => p.file_path)).catch(() => {});
        }
    }
});

test('ST-13 a Sticker.ly share link: the code is read, the page is parsed for this pack\'s stickers only', async () => {
    const stickerly = require('../server/utils/stickerly.utils');
    assert.equal(stickerly.parseLink('https://sticker.ly/s/01R6P7'), '01R6P7');
    assert.equal(stickerly.parseLink('check this https://sticker.ly/s/abc123 pack'), 'ABC123');
    assert.equal(stickerly.parseLink('https://sticker.ly/'), null);
    assert.equal(stickerly.parseLink('https://signalstickers.com/pack/x'), null);
    const html = `<html><head><title>popular meme</title></head><body>
        <div class="sticker_name">popular &amp; meme</div><span class="sticker_author">ianomegalodon</span>
        <img src="https://stickerly.pstatic.net/sticker_pack/aaa/01R6P7/33/one.webp" class="sticker_img">
        <img src="https://stickerly.pstatic.net/sticker_pack/aaa/01R6P7/33/two.webp" class="sticker_img">
        <img src="https://stickerly.pstatic.net/sticker_pack/aaa/01R6P7/33/one.webp" class="sticker_img">
        <img src="https://stickerly.pstatic.net/sticker_pack/bbb/GI1C7D/37/other.webp" class="sticker_img">
        </body></html>`;
    assert.deepEqual(stickerly.parsePage(html, '01R6P7'), {
        name: 'popular & meme', author: 'ianomegalodon',
        urls: ['https://stickerly.pstatic.net/sticker_pack/aaa/01R6P7/33/one.webp', 'https://stickerly.pstatic.net/sticker_pack/aaa/01R6P7/33/two.webp']
    });
    assert.equal((await as(A).post('/stickers/packs', { link: 'https://example.com/sticker.ly/' })).status, 400);

    // the real page and CDN (needs the network)
    if (process.env.TEST_SIGNAL_IMPORT) {
        const res = await as(A).post('/stickers/packs', { link: 'https://sticker.ly/s/01R6P7' });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        const imported = res.body.data.pack;
        try {
            assert.equal(imported.is_mine, true);
            assert.ok(imported.sticker_count >= 5, `stickers: ${imported.sticker_count}`);
            assert.equal(imported.is_animated, true, 'popular meme is an animated pack');
            const [row] = await h.sql('select source, pack_key, owner_user_id from sticker_packs_t where pack_id = ?', [imported.pack_id]);
            assert.deepEqual(row, { source: 'STICKERLY', pack_key: `stickerly:01R6P7:u${A.user.user_id}`, owner_user_id: A.user.user_id });
        } finally {
            const paths = await h.sql('select file_path from stickers_t where pack_id = ?', [imported.pack_id]);
            await h.sql('delete from user_sticker_packs_t where pack_id = ?', [imported.pack_id]);
            await h.sql('delete from stickers_t where pack_id = ?', [imported.pack_id]);
            await h.sql('delete from sticker_packs_t where pack_id = ?', [imported.pack_id]);
            await storage.remove(paths.map((p) => p.file_path)).catch(() => {});
        }
    }
});

test('ST-10 the Signal pack format: links are read, files are decrypted and checked, the manifest is parsed', async () => {
    const packId = crypto.randomBytes(16).toString('hex');
    const packKey = crypto.randomBytes(32).toString('hex');
    assert.deepEqual(signal.parseLink(`https://signal.art/addstickers/#pack_id=${packId}&pack_key=${packKey}`), { packId, packKey });
    assert.deepEqual(signal.parseLink(`https://signalstickers.com/pack/${packId}?key=${packKey}`), { packId, packKey });
    assert.deepEqual(signal.parseLink(`${packId} ${packKey}`), { packId, packKey });
    assert.equal(signal.parseLink('https://signalstickers.com/pack/abc'), null);

    // a file encrypted the way Signal does it: HKDF -> aes key + mac key; iv | aes-256-cbc | hmac
    const keys = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(packKey, 'hex'), Buffer.alloc(32), 'Sticker Pack', 64));
    const encrypt = (plain) => {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keys.subarray(0, 32), iv);
        const body = Buffer.concat([iv, cipher.update(plain), cipher.final()]);
        return Buffer.concat([body, crypto.createHmac('sha256', keys.subarray(32)).update(body).digest()]);
    };
    const plain = Buffer.from('a sticker');
    assert.deepEqual(signal.decrypt(packKey, encrypt(plain)), plain);
    const tampered = encrypt(plain); tampered[20] ^= 1;
    assert.throws(() => signal.decrypt(packKey, tampered), (e) => e.name === 'importFailed');
    assert.throws(() => signal.decrypt(crypto.randomBytes(32).toString('hex'), encrypt(plain)), (e) => e.name === 'importFailed');

    // the manifest protobuf: title (1), author (2), cover (3: Sticker{ id (1), emoji (2) }), stickers (4, repeated)
    const str = (field, text) => Buffer.concat([Buffer.from([(field << 3) | 2, Buffer.byteLength(text)]), Buffer.from(text)]);
    const sticker = (field, id, emoji) => { const inner = Buffer.concat([Buffer.from([(1 << 3) | 0, id]), ...(emoji ? [str(2, emoji)] : [])]); return Buffer.concat([Buffer.from([(field << 3) | 2, inner.length]), inner]); };
    const manifest = Buffer.concat([str(1, 'Cats'), str(2, 'Ann'), sticker(3, 1, '😺'), sticker(4, 0, '😺'), sticker(4, 1, '😸'), sticker(4, 2, null)]);
    assert.deepEqual(signal.parseManifest(manifest), {
        title: 'Cats', author: 'Ann', cover: { id: 1, emoji: '😺', contentType: null },
        stickers: [{ id: 0, emoji: '😺', contentType: null }, { id: 1, emoji: '😸', contentType: null }, { id: 2, emoji: null, contentType: null }]
    });
});
