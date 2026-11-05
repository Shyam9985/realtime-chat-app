const sharp = require('sharp');
const resutils = require('../utils/response.utils');
const storage = require('../utils/storage.utils');
const signal = require('../utils/signal.stickers.utils');
const stickersMdl = require('../models/stickersMdl');
const filesService = require('./filesService');
const cleanup = require('./storageCleanupService');
const { log } = require('../utils/log.utils');

/*
 * Stickers, the way WhatsApp does them: a store of packs, a drawer per user made of the packs they
 * added (the default packs to begin with) and the stickers they starred, and nothing uploaded by users.
 * The shared store is filled by the developer: `npm run import-stickers -- <link>` brings a public Signal
 * sticker pack in (downloaded and decrypted by signal.stickers.utils). A user can bring a pack the same
 * way, by its link: that pack is theirs alone (owner_user_id), in their store and drawer only, though a
 * sticker from it that they send is seen (and can be kept) by whoever receives it, like any sticker. Every still sticker is made the
 * same size (at most 512 px, WebP); an animated one (Signal uses APNG or animated WebP, both of which
 * the app plays as they are) is kept untouched. Files live under stickers/<pack id>/<position>.<ext>.
 * A sticker message carries the sticker's id as its encrypted text, so the server never learns which
 * sticker was sent; only the image downloads are visible to it, like photo downloads.
 */
const STICKER_SIDE = 512;
const MAX_STICKER_BYTES = 500 * 1024;
const MAX_FAVOURITES = 100;
const PREPARE_AT_ONCE = 4;
const STICKER_PREFIX = 'stickers';

const asBool = (v) => v === 1 || v === true;
// userId: whose eyes; is_mine says the pack is one they brought (nobody else sees it in the store)
const shapePack = (row, userId = null) => ({
    pack_id: row.pack_id, title: row.title, author: row.author, source: row.source,
    is_animated: asBool(row.is_animated), sticker_count: row.sticker_count, cover_sticker_id: row.cover_sticker_id,
    is_default: asBool(row.is_default), is_mine: row.owner_user_id != null && Number(row.owner_user_id) === Number(userId),
    ...(row.added !== undefined ? { added: asBool(row.added) } : {})
});
// the shared store's packs when published; a user's own pack only for them
const canSee = (pack, userId) => (pack.owner_user_id == null ? asBool(pack.is_published) : Number(pack.owner_user_id) === Number(userId));
const shapeSticker = (row) => ({ sticker_id: row.sticker_id, pack_id: row.pack_id, position: row.position, is_animated: asBool(row.is_animated), emoji: row.emoji });

// an animated PNG carries an acTL chunk (sharp reads only its first frame, so it is kept as it is)
const isApng = (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.indexOf(Buffer.from('acTL')) > 0;

// one sticker image, checked: a still image becomes WebP of at most 512 px a side; an animated one
// (APNG, animated WebP or GIF) is stored as it came, within the size cap. anything else is refused
const prepareImage = async (bytes) => {
    let meta;
    try { meta = await sharp(bytes, { animated: true }).metadata(); } catch { resutils.createError('importFailed', 'A sticker is not an image.'); }
    if (!['webp', 'png', 'gif', 'jpeg'].includes(meta.format)) resutils.createError('importFailed', `A sticker is a ${meta.format}; only WebP, PNG and GIF stickers can be used.`);
    const isAnimated = (meta.pages || 1) > 1 || isApng(bytes);
    if (isAnimated) {
        if (bytes.length > MAX_STICKER_BYTES) resutils.createError('importFailed', 'An animated sticker is too large.');
        const mimeType = meta.format === 'png' ? 'image/png' : meta.format === 'gif' ? 'image/gif' : 'image/webp';
        return { buffer: bytes, isAnimated: true, mimeType, extension: mimeType.split('/')[1] };
    }
    let buffer = null;
    for (const quality of [85, 70, 55]) {
        buffer = await sharp(bytes, { animated: true })
            .resize({ width: STICKER_SIDE, height: STICKER_SIDE, fit: 'inside', withoutEnlargement: true })
            .webp({ quality, effort: 4 })
            .toBuffer();
        if (buffer.length <= MAX_STICKER_BYTES) break;
    }
    if (buffer.length > MAX_STICKER_BYTES) resutils.createError('importFailed', 'A sticker is too large even after compression.');
    return { buffer, isAnimated: false, mimeType: 'image/webp', extension: 'webp' };
};

// a few at a time: sharp is CPU work
const prepareAll = async (stickers) => {
    const out = new Array(stickers.length);
    let next = 0;
    const worker = async () => {
        while (next < stickers.length) {
            const i = next++;
            out[i] = await prepareImage(stickers[i].bytes);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PREPARE_AT_ONCE, stickers.length) }, worker));
    return out;
};

/*
 * A pack into the store: { packKey, title, author, source, sourceUrl, isDefault, coverIndex,
 * stickers: [{ bytes, emoji }] }. The images are checked and made uniform first, then the pack row is
 * made (hidden), the files stored, the sticker rows written, and the pack published. If anything fails
 * on the way, the files already stored are deleted again and the pack switched off, so the store never
 * shows a half pack.
 */
exports.createPackSrvc = async ({ packKey, title, author, source, sourceUrl = null, isDefault = false, ownerUserId = null, coverIndex = 0, stickers }) => {
    log(`in createPackSrvc ${packKey}: ${stickers.length} sticker(s)`);
    if (!stickers.length) resutils.createError('importFailed', 'This pack has no stickers.');
    if (stickers.length > signal.MAX_STICKERS) resutils.createError('importFailed', `The most a pack may hold is ${signal.MAX_STICKERS} stickers.`);
    const name = (title || '').trim().slice(0, 100) || 'Stickers';
    const by = (author || '').trim().slice(0, 100) || null;
    const prepared = await prepareAll(stickers);

    const existing = await stickersMdl.getPackByKey(packKey);
    if (existing && asBool(existing.is_active)) resutils.createError('packExists', 'This pack is already in the store.');
    let packId;
    if (existing) { packId = existing.pack_id; await stickersMdl.reopenPack(packId, { title: name, author: by, sourceUrl, isDefault }); }
    else packId = await stickersMdl.insertPack({ packKey, title: name, author: by, source, sourceUrl, isDefault, ownerUserId });

    const keys = [];
    try {
        const rows = [];
        for (let i = 0; i < prepared.length; i += 1) {
            const key = `${STICKER_PREFIX}/${packId}/${i}.${prepared[i].extension}`;
            await storage.put(key, prepared[i].buffer, prepared[i].mimeType);
            keys.push(key);
            rows.push({ position: i, filePath: key, mimeType: prepared[i].mimeType, sizeBytes: prepared[i].buffer.length, isAnimated: prepared[i].isAnimated, emoji: (stickers[i].emoji || '').slice(0, 32) || null });
        }
        await stickersMdl.insertStickers(packId, rows);
        const inserted = await stickersMdl.listStickers(packId);
        const cover = inserted.find((s) => s.position === coverIndex) || inserted[0];
        await stickersMdl.publishPack(packId, { stickerCount: inserted.length, isAnimated: prepared.some((p) => p.isAnimated), coverStickerId: cover.sticker_id });
    } catch (error) {
        // the old rows of a reopened pack are gone too (deactivated), so nothing half-made is ever served
        await stickersMdl.deactivatePack(packId).catch(() => {});
        await cleanup.removeFilesSrvc(keys, 'sticker pack import failed');
        throw error;
    }
    return shapePack(await stickersMdl.getPack(packId));
};

// a public Signal sticker pack by its share link; a pack already there is answered as it is.
// ownerUserId: the pack is that user's own (its key carries the user, so two users may bring the same pack)
exports.importPackSrvc = async ({ link, isDefault, ownerUserId = null }) => {
    log('in importPackSrvc');
    const ids = signal.parseLink(link);
    if (!ids) resutils.createError('validationFailed', 'The link holds no Signal sticker pack id and key.');
    const packKey = ownerUserId ? `signal:${ids.packId}:u${ownerUserId}` : `signal:${ids.packId}`;
    const existing = await stickersMdl.getPackByKey(packKey);
    if (existing && asBool(existing.is_active)) {
        // someone else's import of the same pack is still running
        if (!asBool(existing.is_published)) resutils.createError('importFailed', 'This pack is being added right now. Try again in a minute.');
        return { pack: shapePack(existing), already: true };
    }
    const fetched = await signal.fetchPack(ids);
    const coverIndex = Math.max(0, fetched.stickers.findIndex((s) => fetched.cover && s.id === fetched.cover.id));
    const pack = await exports.createPackSrvc({ packKey, title: fetched.title, author: fetched.author, source: 'SIGNAL', sourceUrl: link, isDefault, ownerUserId, coverIndex, stickers: fetched.stickers });
    return { pack, already: false };
};

// a user brings a pack: if the shared store already has it, it just joins their drawer; otherwise it is
// imported as their own pack (nobody else sees it) and put in their drawer
exports.importForUserSrvc = async (userId, link) => {
    log('in importForUserSrvc');
    const ids = signal.parseLink(link);
    if (!ids) resutils.createError('validationFailed', 'The link holds no Signal sticker pack id and key.');
    const shared = await stickersMdl.getPackByKey(`signal:${ids.packId}`);
    if (shared && asBool(shared.is_active) && asBool(shared.is_published)) {
        await stickersMdl.addPack(userId, shared.pack_id);
        return { pack: { ...shapePack(shared, userId), added: true }, already: true };
    }
    const { pack, already } = await exports.importPackSrvc({ link, isDefault: false, ownerUserId: userId });
    await stickersMdl.addPack(userId, pack.pack_id);
    return { pack: { ...pack, is_mine: true, added: true }, already };
};

// ---- what users see
exports.storeSrvc = async (userId) => {
    log('in storeSrvc');
    return { packs: (await stickersMdl.listStore(userId)).map((p) => shapePack(p, userId)) };
};

exports.packSrvc = async (userId, packId) => {
    log('in packSrvc');
    const pack = await stickersMdl.getPack(packId);
    if (!pack || !canSee(pack, userId)) resutils.createError('packNotFound', 'This sticker pack is not in the store.');
    const [stickers, added] = await Promise.all([stickersMdl.listStickers(packId), stickersMdl.hasPack(userId, packId)]);
    return { pack: { ...shapePack(pack, userId), added, stickers: stickers.map(shapeSticker) } };
};

// the drawer: the user's packs with their stickers, and the favourites. a first visit starts with the default packs
exports.drawerSrvc = async (userId) => {
    log('in drawerSrvc');
    if ((await stickersMdl.countDrawer(userId)) === 0) await stickersMdl.addDefaultPacks(userId).catch(() => {});   // two phones at once: the second insert is the duplicate
    const [packs, stickers, favourites] = await Promise.all([stickersMdl.listMyPacks(userId), stickersMdl.listMyStickers(userId), stickersMdl.listFavourites(userId)]);
    const byPack = new Map(packs.map((p) => [p.pack_id, []]));
    for (const s of stickers) byPack.get(s.pack_id)?.push(shapeSticker(s));
    return {
        packs: packs.map((p) => ({ ...shapePack(p, userId), stickers: byPack.get(p.pack_id) || [] })),
        favourites: favourites.map(shapeSticker),
        max_favourites: MAX_FAVOURITES
    };
};

exports.addPackSrvc = async (userId, packId) => {
    log('in addPackSrvc');
    const pack = await stickersMdl.getPack(packId);
    if (!pack || !canSee(pack, userId)) resutils.createError('packNotFound', 'This sticker pack is not in the store.');
    await stickersMdl.addPack(userId, packId);
    return { pack_id: packId, added: true };
};

exports.removePackSrvc = async (userId, packId) => {
    log('in removePackSrvc');
    await stickersMdl.removePack(userId, packId);
    return { pack_id: packId, added: false };
};

exports.addFavouriteSrvc = async (userId, stickerId) => {
    log('in addFavouriteSrvc');
    if (!(await stickersMdl.getSticker(stickerId))) resutils.createError('stickerNotFound', 'This sticker no longer exists.');
    if ((await stickersMdl.countFavourites(userId)) >= MAX_FAVOURITES) resutils.createError('favouritesFull', `You can keep up to ${MAX_FAVOURITES} favourite stickers. Remove one first.`);
    await stickersMdl.addFavourite(userId, stickerId);
    return { sticker_id: stickerId, favourite: true };
};

exports.removeFavouriteSrvc = async (userId, stickerId) => {
    log('in removeFavouriteSrvc');
    await stickersMdl.removeFavourite(userId, stickerId);
    return { sticker_id: stickerId, favourite: false };
};

// the image, for the controller to stream (any signed-in user: stickers are not private to anyone)
exports.imageSrvc = async (stickerId) => {
    log('in imageSrvc');
    return filesService.openStoredFileSrvc(await stickersMdl.getSticker(stickerId), 'This sticker no longer exists.');
};

exports.MAX_FAVOURITES = MAX_FAVOURITES;
