const express = require('express');
const router = express.Router();
const stickersCtrl = require('../controllers/stickersCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

// the sticker store (every pack, with whether the caller has it), one pack with its stickers, the
// caller's drawer (their packs and favourites), adding and removing packs and favourites
router.get('/store', isAuthenticated, checkRateLimit(2, 30), stickersCtrl.store);
router.get('/mine', isAuthenticated, checkRateLimit(2, 30), stickersCtrl.drawer);
router.get('/packs/:id', isAuthenticated, checkRateLimit(2, 30), stickersCtrl.pack);
router.post('/packs/:id/mine', isAuthenticated, checkRateLimit(1, 20), audit('STICKERS', 'ADD_PACK'), stickersCtrl.addPack);
router.delete('/packs/:id/mine', isAuthenticated, checkRateLimit(1, 20), audit('STICKERS', 'REMOVE_PACK'), stickersCtrl.removePack);
router.put('/favourites/:id', isAuthenticated, checkRateLimit(1, 30), stickersCtrl.addFavourite);
router.delete('/favourites/:id', isAuthenticated, checkRateLimit(1, 30), stickersCtrl.removeFavourite);
// a sticker's image: a drawer opens dozens at once, and the phone keeps each one afterwards
router.get('/:id/image', isAuthenticated, checkRateLimit(20, 400), stickersCtrl.image);
// the developer's import of a public Signal sticker pack into the store (x-release-key, like /app/releases)
router.post('/import', checkRateLimit(0.2, 5), audit('STICKERS', 'IMPORT_PACK'), stickersCtrl.importPack);

module.exports = router;
