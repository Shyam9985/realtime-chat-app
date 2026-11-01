/*
 * Integration tests for reliable file deletion: a delete the bucket refuses is retried, then recorded as
 * an orphan instead of being forgotten, and the sweep job deletes it later. The bucket's refusal is
 * simulated by making storage.remove fail; everything else is real (database, bucket).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/testApp');
const storage = require('../server/utils/storage.utils');
const cleanup = require('../server/services/storageCleanupService');

let app;
const KEY = `profile-photos/_orphan-test-${Date.now()}.txt`;

before(async () => { app = await h.start(); });
after(async () => {
    await h.sql('delete from orphaned_files_t where file_path = ?', [KEY]);
    await storage.remove([KEY]).catch(() => {});
    await h.stop(app);
});

test('OR-01 a refused delete is retried, recorded as an orphan, and the sweep removes it from the bucket', async () => {
    await storage.put(KEY, Buffer.from('orphan'), 'text/plain');
    assert.equal(await storage.exists(KEY), true);

    // the bucket refuses twice
    const realRemove = storage.remove;
    let calls = 0;
    storage.remove = async () => { calls += 1; throw new Error('simulated bucket outage'); };
    try {
        const result = await cleanup.removeFilesSrvc([KEY], 'test');
        assert.equal(calls, 2, 'tried, then retried once');
        assert.deepEqual(result, { deleted: 0, orphaned: 1 });
    } finally {
        storage.remove = realRemove;
    }
    const [row] = await h.sql('select reason, attempts, last_error, deleted_at from orphaned_files_t where file_path = ?', [KEY]);
    assert.equal(row.reason, 'test');
    assert.equal(row.last_error, 'simulated bucket outage');
    assert.equal(row.deleted_at, null);
    assert.equal(await storage.exists(KEY), true, 'still in the bucket until the sweep');

    const swept = await cleanup.sweepOrphansSrvc();
    assert.ok(swept.deleted >= 1, JSON.stringify(swept));
    const [after] = await h.sql('select attempts, deleted_at from orphaned_files_t where file_path = ?', [KEY]);
    assert.ok(after.deleted_at, 'marked deleted');
    assert.equal(after.attempts, 1);
    assert.equal(await storage.exists(KEY), false, 'gone from the bucket');
    assert.deepEqual(await cleanup.sweepOrphansSrvc(), { deleted: 0, failed: 0 }, 'nothing left for the next run');
});

test('OR-02 a delete that works leaves no orphan row', async () => {
    await storage.put(KEY, Buffer.from('orphan'), 'text/plain');
    assert.deepEqual(await cleanup.removeFilesSrvc([KEY, KEY, null], 'test'), { deleted: 1, orphaned: 0 });
    assert.equal(await storage.exists(KEY), false);
    assert.equal((await h.sql('select count(*) n from orphaned_files_t where file_path = ? and deleted_at is null', [KEY]))[0].n, 0);
});
