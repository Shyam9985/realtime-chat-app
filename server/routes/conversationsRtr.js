const express = require('express');
const router = express.Router();
const conversationsCtrl = require('../controllers/conversationsCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.get('/', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.list);
router.post('/', isAuthenticated, checkRateLimit(1, 10), audit('CONVERSATION', 'CREATE'), conversationsCtrl.getOrCreate);
router.get('/:id/messages', isAuthenticated, checkRateLimit(5, 60), conversationsCtrl.history);
router.post('/:id/seen', isAuthenticated, checkRateLimit(5, 60), conversationsCtrl.markSeen);

module.exports = router;
