/*
 * Integration tests for app updates (GET /app/latest). Releases are written straight to the table with
 * very high version codes, so they sit above any real release, and are removed afterwards.
 */
process.env.RELEASE_PUBLISH_KEY = 'it-release-key-'.padEnd(64, 'k');     // publishing on, with a known key
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');

let app;
const anon = () => h.api(app.baseUrl);
const latest = async (code) => (await anon().get(`/app/latest?version_code=${code}`)).body.data;
const release = (version, code, mandatory) => h.sql(
    'insert into app_releases_t (version, version_code, apk_url, notes, is_mandatory) values (?, ?, ?, ?, ?)',
    [version, code, `https://example.test/${version}.apk`, `notes ${version}`, mandatory ? 1 : 0]);

before(async () => {
    app = await h.start();
    await release('it-99.1.0', 990100, false);
    await release('it-99.2.0', 990200, true);
    await release('it-99.3.0', 990300, false);
});

after(async () => {
    await h.sql("delete from app_releases_t where version like 'it-%' or version like '99.%'");
    await h.stop(app);
});

test('UP-01 the newest build is up to date', async () => {
    const r = await latest(990300);
    assert.equal(r.update_available, false);
    assert.equal(r.mandatory, false);
    assert.equal(r.latest.version, 'it-99.3.0');
});

test('UP-02 an older build hears about the newest release, optional when nothing mandatory lies between', async () => {
    const r = await latest(990200);
    assert.equal(r.update_available, true);
    assert.equal(r.mandatory, false);
    assert.deepEqual([r.latest.version, r.latest.version_code, r.latest.apk_url, r.latest.notes], ['it-99.3.0', 990300, 'https://example.test/it-99.3.0.apk', 'notes it-99.3.0']);
});

test('UP-03 a mandatory release that was skipped still forces the update', async () => {
    const r = await latest(990100);
    assert.equal(r.update_available, true);
    assert.equal(r.mandatory, true, '99.2.0 is mandatory even though the newest, 99.3.0, is not');
    assert.equal(r.latest.version, 'it-99.3.0', 'the update goes straight to the newest');
});

test('UP-04 no sign-in needed; a missing or bad version_code is refused', async () => {
    assert.equal((await anon().get('/app/latest?version_code=10100')).status, 200);
    assert.equal((await anon().get('/app/latest')).status, 400);
    assert.equal((await anon().get('/app/latest?version_code=abc')).status, 400);
    assert.equal((await anon().get('/app/latest?version_code=-5')).status, 400);
});

// the publish script runs without a sign-in, so like other such requests each comes from its own address
const publish = (body, key = process.env.RELEASE_PUBLISH_KEY) => h.anonymousCall(app.baseUrl, 'POST', '/app/releases', body, undefined, key ? { 'x-release-key': key } : {});
const good = { version: '99.4.0', version_code: 990400, apk_url: 'https://example.test/99.4.0.apk', notes: 'Release notes', is_mandatory: true };

test('UP-05 publishing needs the release key', async () => {
    assert.equal((await publish(good, null)).status, 403);
    assert.equal((await publish(good, 'wrong'.padEnd(64, 'x'))).status, 403);
});

test('UP-06 the version, its code and the link are checked; only a newer version is accepted', async () => {
    assert.equal((await publish({ ...good, version: '99.4' })).status, 400, 'not semver');
    assert.equal((await publish({ ...good, version_code: 990401 })).status, 400, 'code does not match the version');
    assert.equal((await publish({ ...good, apk_url: 'http://example.test/x.apk' })).status, 400, 'https only');
    assert.equal((await publish({ ...good, version: '99.2.1', version_code: 990201 })).status, 400, 'older than the latest');
});

test('UP-07 a published release is what older builds are offered next', async () => {
    const res = await publish(good);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.release.version, '99.4.0');
    assert.equal(typeof res.body.data.notified_devices, 'number');
    const r = await latest(990300);
    assert.deepEqual([r.update_available, r.mandatory, r.latest.version], [true, true, '99.4.0']);
    assert.equal((await publish(good)).status, 400, 'the same version twice is refused');
});
