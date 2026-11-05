const resutils = require('../utils/response.utils');
const RESPONSE_STATUS = require('../utils/standard.messages');
const stickersService = require('../services/stickersService');
const appReleasesService = require('../services/appReleasesService');
const stickersVldtr = require('../validators/stickersVldtr');
const { sendStoredFile } = require('./filesCtrl');
const { sendChatError } = require('./usersCtrl');
const { log } = require('../utils/log.utils');

// validate the request, run the service, answer with its result, map named errors (the same shape as the chat controllers)
const handle = (fname, status, run) => async (req, res) => {
    log(`in ${fname}`);
    try {
        return resutils.sendSuccessResponse(req, res, await run(req), status, { function: fname });
    } catch (error) {
        return sendChatError(req, res, error, fname);
    }
};

// GET /stickers/store  - every pack in the store, with whether the caller already has it
exports.store = handle('stickers store', RESPONSE_STATUS.DATA_FOUND, (req) => stickersService.storeSrvc(req.user.user_id));

// GET /stickers/mine  - the caller's drawer: their packs with the stickers, and their favourites
exports.drawer = handle('stickers drawer', RESPONSE_STATUS.DATA_FOUND, (req) => stickersService.drawerSrvc(req.user.user_id));

// GET /stickers/packs/:id  - one pack with its stickers
exports.pack = handle('stickers pack', RESPONSE_STATUS.DATA_FOUND, (req) => stickersService.packSrvc(req.user.user_id, stickersVldtr.packId(req.params.id)));

// POST /stickers/packs/:id/mine  - the pack joins the caller's drawer
exports.addPack = handle('stickers add pack', RESPONSE_STATUS.CREATED, (req) => stickersService.addPackSrvc(req.user.user_id, stickersVldtr.packId(req.params.id)));

// DELETE /stickers/packs/:id/mine
exports.removePack = handle('stickers remove pack', RESPONSE_STATUS.DELETED, (req) => stickersService.removePackSrvc(req.user.user_id, stickersVldtr.packId(req.params.id)));

// PUT /stickers/favourites/:id  - a sticker (own or received) starred
exports.addFavourite = handle('stickers add favourite', RESPONSE_STATUS.CREATED, (req) => stickersService.addFavouriteSrvc(req.user.user_id, stickersVldtr.stickerId(req.params.id)));

// DELETE /stickers/favourites/:id
exports.removeFavourite = handle('stickers remove favourite', RESPONSE_STATUS.DELETED, (req) => stickersService.removeFavouriteSrvc(req.user.user_id, stickersVldtr.stickerId(req.params.id)));

// POST /stickers/packs  { link }  - a signed-in user adds a public Signal pack by its share link: into
// the store for everyone, and into their own drawer
exports.importByUser = handle('stickers user import', RESPONSE_STATUS.CREATED, (req) => stickersService.importForUserSrvc(req.user.user_id, stickersVldtr.validateImport(req.body || {}).link));

// GET /stickers/:id/image  - the sticker's image, streamed from storage. a sticker never changes, so the
// phone may keep it for good
exports.image = async (req, res) => {
    log('in stickers image');
    try {
        const file = await stickersService.imageSrvc(stickersVldtr.stickerId(req.params.id));
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        await sendStoredFile(res, file);
    } catch (error) {
        if (res.headersSent) return undefined;
        return sendChatError(req, res, error, 'stickers image');
    }
};

// POST /stickers/import  { link, is_default? }  - the import script adds a public Signal sticker pack
// to the store (x-release-key header, the same key as publishing a release)
exports.importPack = handle('stickers import', RESPONSE_STATUS.CREATED, (req) => {
    // the key first: the body is only looked at for a caller allowed to import
    appReleasesService.assertPublisherSrvc(req.get('x-release-key'));
    return stickersService.importPackSrvc(stickersVldtr.validateImport(req.body || {}));
});
