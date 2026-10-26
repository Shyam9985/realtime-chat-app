const express = require('express');
const router = express.Router();
const usersCtrl = require('../controllers/usersCtrl');
const filesCtrl = require('../controllers/filesCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.get('/', isAuthenticated, checkRateLimit(2, 30), usersCtrl.search);
router.get('/blocked', isAuthenticated, checkRateLimit(1, 30), usersCtrl.listBlocked);
router.get('/:id', isAuthenticated, checkRateLimit(2, 60), usersCtrl.getProfile);
router.get('/:id/photo', isAuthenticated, checkRateLimit(5, 120), filesCtrl.getUserPhoto);
router.post('/:id/block', isAuthenticated, checkRateLimit(0.2, 10), audit('USER', 'BLOCK'), usersCtrl.block);
router.delete('/:id/block', isAuthenticated, checkRateLimit(0.2, 10), audit('USER', 'UNBLOCK'), usersCtrl.unblock);

module.exports = router;
