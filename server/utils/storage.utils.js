const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { createClient } = require('@supabase/supabase-js');
const { log } = require('./log.utils');

/*
 * Where uploaded files are kept: a PRIVATE bucket in Supabase Storage. Only the server reads and writes
 * it (the secret key never leaves the server), so the app's own access rules (blocks, membership) still
 * decide who gets a file, and a deploy never wipes the files (the free render disk is lost on every
 * deploy, so it is not used for anything kept). There is no other storage: without SUPABASE_URL,
 * SUPABASE_SECRET_KEY and SUPABASE_BUCKET the server does not start. A key is the stored file_path: "profile-photos/<name>.jpg", "group-photos/<name>.jpg", ...
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;

if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_BUCKET) {
    throw new Error('File storage is not configured: set SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_BUCKET.');
}
const bucket = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(SUPABASE_BUCKET);

// supabase-js reports failures as a result, not an exception
const unwrap = ({ data, error }, what) => {
    if (error) {
        const failure = new Error(`storage ${what}: ${error.message}`);
        failure.name = 'StorageError';
        throw failure;
    }
    return data;
};

// stores a file (a Buffer) under key, replacing any file already there
const put = async (key, buffer, contentType) => {
    log(`in storage put: ${key}`);
    unwrap(await bucket.upload(key, buffer, { contentType, upsert: true }), `upload ${key}`);
};

// the whole file as a Buffer, or null when there is none
const read = async (key) => {
    log(`in storage read: ${key}`);
    const { data, error } = await bucket.download(key);
    if (error) return null;
    return Buffer.from(await data.arrayBuffer());
};

// the file as a readable stream with its size, or null when there is none (the controllers pipe it out)
const get = async (key) => {
    const buffer = await read(key);
    return buffer ? { stream: Readable.from(buffer), size: buffer.length } : null;
};

const exists = async (key) => {
    const dir = path.posix.dirname(key);
    const name = path.posix.basename(key);
    const rows = unwrap(await bucket.list(dir === '.' ? '' : dir, { limit: 1, search: name }), `list ${key}`);
    return rows.some((r) => r.name === name);
};

// deletes these files; ones already gone are fine. a refusal throws: storageCleanupService retries it
// and records what still fails, so nothing is silently left behind
const remove = async (keys) => {
    const list = [...new Set(keys.filter(Boolean).map(String))];
    if (!list.length) return;
    log(`in storage remove: ${list.length} file(s)`);
    unwrap(await bucket.remove(list), `remove ${list.length} file(s)`);
};

// a temporary file for an upload in flight: the bytes are checked and compressed from here, then the
// result goes to the bucket and this file is deleted. the machine's temp folder, never anything kept
const TEMP_DIR = path.join(os.tmpdir(), 'yaapzone-uploads');
const tempPath = async (name) => {
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });
    return path.join(TEMP_DIR, name);
};

module.exports = { put, get, read, exists, remove, tempPath };
