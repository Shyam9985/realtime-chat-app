const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { log } = require('./log.utils');

/*
 * Reading a public Signal sticker pack, the format every pack on signalstickers.com is in. A pack is
 * identified by a 32-hex id and opened with a 64-hex key, both in the share link
 * (signal.art/addstickers/#pack_id=...&pack_key=... or signalstickers.com/pack/<id>?key=...). The files
 * live on cdn.signal.org: a manifest (protobuf: title, author, cover, stickers with an emoji each) and
 * one encrypted file per sticker. Each file is AES-256-CBC + HMAC-SHA256 under keys derived from the
 * pack key with HKDF (info "Sticker Pack"). Signal's CDN presents a certificate from Signal's own
 * authority, not a public one, so that authority (server/config/signal-ca.pem) is the only one trusted
 * for these downloads: the connection is verified against exactly it.
 */
const CA = fs.readFileSync(path.join(__dirname, '../config/signal-ca.pem'));
const CDN = 'https://cdn.signal.org/stickers';
const MAX_FILE_BYTES = 3 * 1024 * 1024;      // one encrypted sticker file
const MAX_STICKERS = 200;
const DOWNLOADS_AT_ONCE = 4;

const fail = (message, statusCode) => { const error = new Error(message); error.name = 'importFailed'; error.statusCode = statusCode; return error; };

// the pack id and key out of a share link (either site), or null when the link has neither
exports.parseLink = (link) => {
    const text = String(link || '');
    const id = text.match(/pack_id=([0-9a-f]{32})/i) || text.match(/\/pack\/([0-9a-f]{32})\b/i) || text.match(/\b([0-9a-f]{32})\b/i);
    const key = text.match(/(?:pack_key|key)=([0-9a-f]{64})/i) || text.match(/\b([0-9a-f]{64})\b/i);
    if (!id || !key) return null;
    return { packId: id[1].toLowerCase(), packKey: key[1].toLowerCase() };
};

// one file from the CDN as a Buffer; anything but 200 is a failure the caller can explain
const download = (url) => new Promise((resolve, reject) => {
    const request = https.get(url, { ca: CA, timeout: 20000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return reject(fail(`Signal's CDN answered ${res.statusCode}.`, res.statusCode)); }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_FILE_BYTES) res.destroy(fail('A sticker file is too large.'));
            else chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
    });
    request.on('timeout', () => request.destroy(fail("Signal's CDN did not answer in time.")));
    request.on('error', (error) => reject(error.name === 'importFailed' ? error : fail(`Could not reach Signal's CDN: ${error.message}`)));
});

// AES key and HMAC key from the pack key; then the file: iv (16) | ciphertext | mac (32)
const decrypt = (packKey, data) => {
    const keys = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(packKey, 'hex'), Buffer.alloc(32), 'Sticker Pack', 64));
    const aesKey = keys.subarray(0, 32);
    const macKey = keys.subarray(32);
    if (data.length < 16 + 16 + 32) throw fail('A sticker file is damaged.');
    const iv = data.subarray(0, 16);
    const mac = data.subarray(data.length - 32);
    const body = data.subarray(16, data.length - 32);
    const expected = crypto.createHmac('sha256', macKey).update(data.subarray(0, data.length - 32)).digest();
    if (!crypto.timingSafeEqual(mac, expected)) throw fail('The pack key is wrong for this pack.');
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    return Buffer.concat([decipher.update(body), decipher.final()]);
};

// ---- the manifest: a tiny protobuf reader (varints and length-delimited fields are all it uses)
const readVarint = (buffer, at) => {
    let value = 0n;
    let shift = 0n;
    let pos = at;
    for (;;) {
        if (pos >= buffer.length) throw fail('The pack manifest is damaged.');
        const byte = buffer[pos++];
        value |= BigInt(byte & 0x7f) << shift;
        if (!(byte & 0x80)) break;
        shift += 7n;
    }
    return [Number(value), pos];
};

const fields = (buffer) => {
    const out = [];
    let pos = 0;
    while (pos < buffer.length) {
        let tag;
        [tag, pos] = readVarint(buffer, pos);
        const field = tag >> 3;
        const wire = tag & 7;
        if (wire === 0) { let value; [value, pos] = readVarint(buffer, pos); out.push({ field, value }); }
        else if (wire === 2) { let length; [length, pos] = readVarint(buffer, pos); out.push({ field, value: buffer.subarray(pos, pos + length) }); pos += length; }
        else if (wire === 1) pos += 8;
        else if (wire === 5) pos += 4;
        else throw fail('The pack manifest is damaged.');
    }
    return out;
};

const text = (value) => (Buffer.isBuffer(value) ? value.toString('utf8') : '');
const stickerOf = (buffer) => {
    const sticker = { id: 0, emoji: null, contentType: null };
    for (const f of fields(buffer)) {
        if (f.field === 1 && typeof f.value === 'number') sticker.id = f.value;
        else if (f.field === 2) sticker.emoji = text(f.value) || null;
        else if (f.field === 3) sticker.contentType = text(f.value) || null;
    }
    return sticker;
};
// { title, author, cover: { id, emoji }, stickers: [{ id, emoji, contentType }] }
exports.parseManifest = (buffer) => {
    const manifest = { title: '', author: '', cover: null, stickers: [] };
    for (const f of fields(buffer)) {
        if (f.field === 1) manifest.title = text(f.value);
        else if (f.field === 2) manifest.author = text(f.value);
        else if (f.field === 3 && Buffer.isBuffer(f.value)) manifest.cover = stickerOf(f.value);
        else if (f.field === 4 && Buffer.isBuffer(f.value)) manifest.stickers.push(stickerOf(f.value));
    }
    return manifest;
};

// the whole pack, decrypted: the manifest plus every sticker's bytes, a few downloads at a time
exports.fetchPack = async ({ packId, packKey }) => {
    log(`in signal fetchPack ${packId}`);
    const manifest = exports.parseManifest(decrypt(packKey, await download(`${CDN}/${packId}/manifest.proto`)));
    if (!manifest.stickers.length) throw fail('This pack has no stickers.');
    if (manifest.stickers.length > MAX_STICKERS) throw fail(`This pack has ${manifest.stickers.length} stickers; the most allowed is ${MAX_STICKERS}.`);
    const stickers = manifest.stickers.map((s) => ({ ...s, bytes: null }));
    let next = 0;
    const worker = async () => {
        while (next < stickers.length) {
            const sticker = stickers[next++];
            sticker.bytes = decrypt(packKey, await download(`${CDN}/${packId}/full/${sticker.id}`));
        }
    };
    await Promise.all(Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, stickers.length) }, worker));
    return { title: manifest.title, author: manifest.author, cover: manifest.cover, stickers };
};

exports.decrypt = decrypt;
exports.MAX_STICKERS = MAX_STICKERS;
