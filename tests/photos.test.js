/*
 * Integration tests for profile photos (POST /files/upload, GET /users/:id/photo): uploads up to 5 MB,
 * stored as a compressed JPEG of at most 1 MB, a new photo replaces the old one completely (row and
 * file), and other members receive it. Real server, real database, real files.
 */
const fs = require('fs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const h = require('./helpers/testApp');
const { resolveStoredPath } = require('../server/utils/files.utils');

let app, A, B, first;
const upload = (u, body, type = 'image/jpeg', name = 'me.jpg') => fetch(`${app.baseUrl}/apiv1/files/upload`, {
    method: 'POST', body, headers: { 'access-token': `Bearer ${u.token}`, 'content-type': type, 'x-file-name': name },
}).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
const rowsOf = (u) => h.sql("select file_id, file_path, size_bytes from uploaded_files_lst_t where entity_type = 'USER_PROFILE' and entity_id = ?", [u.user.user_id]);

// a photo-like image: random noise compresses badly, so it stays big
const noisyJpeg = async (width, height, quality) => sharp(Buffer.from(Array.from({ length: width * height * 3 }, () => Math.floor(Math.random() * 256))),
    { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();

before(async () => {
    app = await h.start();
    [A, B] = await Promise.all([h.createUser(app.baseUrl, 'Alice'), h.createUser(app.baseUrl, 'Bob')]);
});

after(async () => {
    await h.cleanupUsers([A, B].filter(Boolean).map((u) => u.user.user_id));
    await h.stop(app);
});

test('PH-01 a big photo is stored as a JPEG of at most 1 MB and 1080 px', async () => {
    const big = await noisyJpeg(2000, 1500, 92);
    assert.ok(big.length > 1024 * 1024 && big.length <= 5 * 1024 * 1024, `test photo is ${big.length} bytes`);
    const res = await upload(A, big);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [row] = await rowsOf(A);
    first = row;
    const stored = fs.readFileSync(resolveStoredPath(row.file_path));
    assert.ok(stored.length <= 1024 * 1024, `stored ${stored.length} bytes`);
    assert.equal(stored.length, row.size_bytes);
    const meta = await sharp(stored).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(meta.width <= 1080 && meta.height <= 1080, `${meta.width}x${meta.height}`);
});

test('PH-02 a new photo replaces the old one completely: row and file', async () => {
    const res = await upload(A, await sharp({ create: { width: 400, height: 400, channels: 3, background: '#128C5E' } }).png().toBuffer(), 'image/png', 'new.png');
    assert.equal(res.status, 201);
    const rows = await rowsOf(A);
    assert.equal(rows.length, 1, 'only the newest photo is kept');
    assert.notEqual(rows[0].file_id, first.file_id);
    assert.equal(fs.existsSync(resolveStoredPath(first.file_path)), false, 'the old file is gone from disk');
    assert.equal(fs.existsSync(resolveStoredPath(rows[0].file_path)), true);
    const [user] = await h.sql('select profile_photo_url from users_lst_t where user_id = ?', [A.user.user_id]);
    assert.equal(user.profile_photo_url, rows[0].file_path, 'the user points at the new photo');
});

test('PH-03 more than 5 MB, or something that is not really an image, is refused', async () => {
    const tooBig = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    assert.equal((await upload(A, tooBig)).status, 400);
    assert.equal((await upload(A, Buffer.from('this is not a picture'))).status, 400);
    assert.equal((await rowsOf(A)).length, 1, 'refused uploads leave nothing behind');
});

test('PH-04 other members receive the stored photo', async () => {
    const [row] = await rowsOf(A);
    const res = await fetch(`${app.baseUrl}/apiv1/users/${A.user.user_id}/photo`, { headers: { 'access-token': `Bearer ${B.token}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), fs.readFileSync(resolveStoredPath(row.file_path)));
});
