const express = require('express');
const router = express.Router();
const messagesCtrl = require('../controllers/messagesCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.post('/', isAuthenticated, checkRateLimit(2, 20), messagesCtrl.send);
router.delete('/:id', isAuthenticated, checkRateLimit(1, 10), audit('MESSAGE', 'DELETE'), messagesCtrl.deleteForEveryone);
router.post('/:id/delivered', isAuthenticated, checkRateLimit(10, 100), messagesCtrl.markDelivered);
router.patch('/:id', isAuthenticated, checkRateLimit(1, 10), audit('MESSAGE', 'EDIT'), messagesCtrl.edit);
router.get('/:id/edits', isAuthenticated, checkRateLimit(1, 20), messagesCtrl.editHistory);
router.post('/:id/forward', isAuthenticated, checkRateLimit(0.5, 10), audit('MESSAGE', 'FORWARD'), messagesCtrl.forward);

module.exports = router;
