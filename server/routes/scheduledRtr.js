const express = require('express');
const router = express.Router();
const conversationsCtrl = require('../controllers/conversationsCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

// change or cancel one of the caller's pending scheduled messages
router.patch('/:id', isAuthenticated, checkRateLimit(0.5, 10), audit('SCHEDULED_MESSAGE', 'UPDATE'), conversationsCtrl.updateScheduled);
router.delete('/:id', isAuthenticated, checkRateLimit(0.5, 10), audit('SCHEDULED_MESSAGE', 'CANCEL'), conversationsCtrl.cancelScheduled);

module.exports = router;
