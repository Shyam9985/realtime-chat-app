const storage = require('../utils/storage.utils');
const orphansMdl = require('../models/orphansMdl');
const { log, logBlock } = require('../utils/log.utils');

/*
 * Deleting files from storage, reliably. Every service that drops files (a replaced or removed photo, a
 * deleted account) comes through here, after its database change has committed: the delete is tried,
 * retried once, and if the bucket still refuses, the paths are recorded as orphans instead of being
 * forgotten. The hourly sweep (schedule.utils) retries those until they are gone. The caller's request
 * never fails because of a delete: its change is already saved, and nothing is left behind for good.
 */
const SWEEP_BATCH = 200;

const tryRemove = async (paths) => {
    try { await storage.remove(paths); return null; } catch (error) { return error; }
};

// deletes these files; what the bucket refuses twice is recorded for the sweep
exports.removeFilesSrvc = async (paths, reason) => {
    const list = [...new Set((paths || []).filter(Boolean))];
    if (!list.length) return { deleted: 0, orphaned: 0 };
    log(`in removeFilesSrvc: ${list.length} file(s), ${reason}`);
    let error = await tryRemove(list);
    if (error) error = await tryRemove(list);
    if (!error) return { deleted: list.length, orphaned: 0 };
    console.error(`[storage] could not delete ${list.length} file(s) (${reason}), recorded for the sweep:`, error.message);
    await orphansMdl.recordOrphans(list, reason, String(error.message).slice(0, 255));
    return { deleted: 0, orphaned: list.length };
};

// the job: every recorded file that is still there is tried again
exports.sweepOrphansSrvc = async () => {
    const pending = await orphansMdl.listPending(SWEEP_BATCH);
    if (!pending.length) return { deleted: 0, failed: 0 };
    const error = await tryRemove(pending.map((p) => p.file_path));
    const ids = pending.map((p) => p.orphan_id);
    if (error) {
        await orphansMdl.markFailed(ids, String(error.message).slice(0, 255));
        logBlock('[orphaned files job] still failing:', `${ids.length} file(s): ${error.message}`);
        return { deleted: 0, failed: ids.length };
    }
    await orphansMdl.markDeleted(ids);
    logBlock('[orphaned files job] deleted:', `${ids.length} file(s)`);
    return { deleted: ids.length, failed: 0 };
};
