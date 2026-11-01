const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

/*
 * The sticker store (sticker_packs_t, stickers_t) and what each user took from it: the packs in their
 * drawer (user_sticker_packs_t) and the stickers they starred (user_favourite_stickers_t). The images
 * themselves live in storage under stickers_t.file_path.
 */
const PACK_COLUMNS = 'p.pack_id, p.pack_key, p.title, p.author, p.source, p.is_animated, p.sticker_count, p.cover_sticker_id, p.is_default, p.is_published';
const STICKER_COLUMNS = 's.sticker_id, s.pack_id, s.position, s.is_animated, s.emoji';

// ---- packs (the store)
exports.getPackByKey = (packKey) => {
    log('in getPackByKey');
    return dbutils.executeQuery(`select ${PACK_COLUMNS}, p.is_active from sticker_packs_t p where p.pack_key = ?`, [packKey], 'get pack by key').then((rows) => rows[0] || null);
};

exports.getPack = (packId) => {
    log('in getPack');
    return dbutils.executeQuery(`select ${PACK_COLUMNS} from sticker_packs_t p where p.pack_id = ? and p.is_active = 1`, [packId], 'get pack').then((rows) => rows[0] || null);
};

// a new pack, hidden from the store until its stickers are all in (publishPack)
exports.insertPack = ({ packKey, title, author, source, sourceUrl, isDefault }) => {
    log('in insertPack');
    const qry = `insert into sticker_packs_t (pack_key, title, author, source, source_url, is_default, is_published)
        values (?, ?, ?, ?, ?, ?, 0)`;
    return dbutils.executeQuery(qry, [packKey, title, author, source, sourceUrl, isDefault ? 1 : 0], 'insert pack').then((result) => result.insertId);
};

// a pack imported again after a failed attempt (or after being switched off): the row is reused, its
// old stickers (and stars on them) go, so the new ones can take their positions
exports.reopenPack = (packId, { title, author, sourceUrl, isDefault }) => {
    log('in reopenPack');
    return dbutils.executeTransaction(async (connection) => {
        await connection.execute('delete f from user_favourite_stickers_t f join stickers_t s on s.sticker_id = f.sticker_id where s.pack_id = ?', [packId]);
        await connection.execute('delete from stickers_t where pack_id = ?', [packId]);
        await connection.execute('update sticker_packs_t set title = ?, author = ?, source_url = ?, is_default = ?, is_published = 0, is_active = 1 where pack_id = ?',
            [title, author, sourceUrl, isDefault ? 1 : 0, packId]);
    }, 'reopen pack');
};

// rows: [{ position, filePath, mimeType, sizeBytes, isAnimated, emoji }]
exports.insertStickers = (packId, rows) => {
    log('in insertStickers');
    const qry = `insert into stickers_t (pack_id, position, file_path, mime_type, size_bytes, is_animated, emoji)
        values ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`;
    return dbutils.executeQuery(qry, rows.flatMap((r) => [packId, r.position, r.filePath, r.mimeType, r.sizeBytes, r.isAnimated ? 1 : 0, r.emoji]), 'insert stickers');
};

exports.publishPack = (packId, { stickerCount, isAnimated, coverStickerId }) => {
    log('in publishPack');
    const qry = 'update sticker_packs_t set sticker_count = ?, is_animated = ?, cover_sticker_id = ?, is_published = 1 where pack_id = ?';
    return dbutils.executeQuery(qry, [stickerCount, isAnimated ? 1 : 0, coverStickerId, packId], 'publish pack');
};

// an import that failed half way: the pack and whatever stickers got in are switched off
exports.deactivatePack = (packId) => {
    log('in deactivatePack');
    return dbutils.executeTransaction(async (connection) => {
        await connection.execute('update stickers_t set is_active = 0 where pack_id = ?', [packId]);
        await connection.execute('update sticker_packs_t set is_active = 0, is_published = 0 where pack_id = ?', [packId]);
    }, 'deactivate pack');
};

exports.listStickerPaths = (packId) => {
    log('in listStickerPaths');
    return dbutils.executeQuery('select file_path from stickers_t where pack_id = ?', [packId], 'list sticker paths');
};

// every published pack, newest first after the defaults, with whether this user has it in their drawer
exports.listStore = (userId) => {
    log('in listStore');
    const qry = `with mine as (select pack_id from user_sticker_packs_t where user_id = ?)
        select ${PACK_COLUMNS}, case when m.pack_id is null then 0 else 1 end as added
        from sticker_packs_t p
        left join mine m on m.pack_id = p.pack_id
        where p.is_published = 1 and p.is_active = 1
        order by p.is_default desc, p.pack_id desc`;
    return dbutils.executeQuery(qry, [userId], 'list store');
};

exports.listStickers = (packId) => {
    log('in listStickers');
    return dbutils.executeQuery(`select ${STICKER_COLUMNS} from stickers_t s where s.pack_id = ? and s.is_active = 1 order by s.position`, [packId], 'list stickers');
};

// the row a sticker's image is served from (none when the sticker or its pack is switched off)
exports.getSticker = (stickerId) => {
    log('in getSticker');
    const qry = `select ${STICKER_COLUMNS}, s.file_path, s.mime_type, s.size_bytes
        from stickers_t s join sticker_packs_t p on p.pack_id = s.pack_id
        where s.sticker_id = ? and s.is_active = 1 and p.is_active = 1`;
    return dbutils.executeQuery(qry, [stickerId], 'get sticker').then((rows) => rows[0] || null);
};

// ---- a user's drawer
exports.countDrawer = (userId) => {
    log('in countDrawer');
    return dbutils.executeQuery('select count(*) as n from user_sticker_packs_t where user_id = ?', [userId], 'count drawer').then((rows) => Number(rows[0].n));
};

// a first drawer: every default pack, in store order
exports.addDefaultPacks = (userId) => {
    log('in addDefaultPacks');
    const qry = `insert into user_sticker_packs_t (user_id, pack_id, position)
        select ?, pack_id, row_number() over (order by pack_id) - 1
        from sticker_packs_t where is_default = 1 and is_published = 1 and is_active = 1`;
    return dbutils.executeQuery(qry, [userId], 'add default packs');
};

exports.hasPack = (userId, packId) => {
    log('in hasPack');
    return dbutils.executeQuery('select user_pack_id from user_sticker_packs_t where user_id = ? and pack_id = ?', [userId, packId], 'has pack').then((rows) => rows.length > 0);
};

// the pack goes to the end of the drawer; adding one already there changes nothing
exports.addPack = (userId, packId) => {
    log('in addPack');
    // an upsert, so through executeTransaction: the query guard reads "on duplicate key update" as an update without a where
    const qry = `insert into user_sticker_packs_t (user_id, pack_id, position)
        select ?, ?, coalesce(max(position) + 1, 0) from user_sticker_packs_t where user_id = ?
        on duplicate key update is_active = 1`;
    return dbutils.executeTransaction((connection) => connection.execute(qry, [userId, packId, userId]), 'add pack to drawer');
};

exports.removePack = (userId, packId) => {
    log('in removePack');
    return dbutils.executeQuery('delete from user_sticker_packs_t where user_id = ? and pack_id = ?', [userId, packId], 'remove pack from drawer');
};

exports.listMyPacks = (userId) => {
    log('in listMyPacks');
    const qry = `select ${PACK_COLUMNS}
        from user_sticker_packs_t u join sticker_packs_t p on p.pack_id = u.pack_id
        where u.user_id = ? and p.is_active = 1
        order by u.position, u.user_pack_id`;
    return dbutils.executeQuery(qry, [userId], 'list my packs');
};

// the stickers of every pack in the drawer, in one go
exports.listMyStickers = (userId) => {
    log('in listMyStickers');
    const qry = `select ${STICKER_COLUMNS}
        from user_sticker_packs_t u join stickers_t s on s.pack_id = u.pack_id and s.is_active = 1
        where u.user_id = ?
        order by s.pack_id, s.position`;
    return dbutils.executeQuery(qry, [userId], 'list my stickers');
};

// ---- favourites
exports.countFavourites = (userId) => {
    log('in countFavourites');
    return dbutils.executeQuery('select count(*) as n from user_favourite_stickers_t where user_id = ?', [userId], 'count favourites').then((rows) => Number(rows[0].n));
};

exports.addFavourite = (userId, stickerId) => {
    log('in addFavourite');
    return dbutils.executeQuery('insert ignore into user_favourite_stickers_t (user_id, sticker_id) values (?, ?)', [userId, stickerId], 'add favourite');
};

exports.removeFavourite = (userId, stickerId) => {
    log('in removeFavourite');
    return dbutils.executeQuery('delete from user_favourite_stickers_t where user_id = ? and sticker_id = ?', [userId, stickerId], 'remove favourite');
};

// newest first
exports.listFavourites = (userId) => {
    log('in listFavourites');
    const qry = `select ${STICKER_COLUMNS}
        from user_favourite_stickers_t f join stickers_t s on s.sticker_id = f.sticker_id and s.is_active = 1
        join sticker_packs_t p on p.pack_id = s.pack_id and p.is_active = 1
        where f.user_id = ?
        order by f.favourite_id desc`;
    return dbutils.executeQuery(qry, [userId], 'list favourites');
};
