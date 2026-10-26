const express = require('express');
const router = express.Router();
const messagesCtrl = require('../controllers/messagesCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.post('/', isAuthenticated, checkRateLimit(2, 20), messagesCtrl.send);
router.delete('/:id', isAuthenticated, checkRateLimit(1, 10), audit('MESSAGE', 'DELETE'), messagesCtrl.deleteForEveryone);
router.post('/:id/delivered', isAuthenticated, checkRateLimit(10, 100), messagesCtrl.markDelivered);

module.exports = router;
