const express = require('express');
const router = express.Router();
const conversationsCtrl = require('../controllers/conversationsCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.get('/', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.list);
router.post('/read-all', isAuthenticated, checkRateLimit(0.2, 5), audit('CONVERSATION', 'READ_ALL'), conversationsCtrl.readAll);
router.post('/', isAuthenticated, checkRateLimit(1, 10), audit('CONVERSATION', 'CREATE'), conversationsCtrl.getOrCreate);
router.get('/:id/messages', isAuthenticated, checkRateLimit(5, 60), conversationsCtrl.history);
router.post('/:id/seen', isAuthenticated, checkRateLimit(5, 60), conversationsCtrl.markSeen);
router.get('/:id/messages/search', isAuthenticated, checkRateLimit(1, 20), conversationsCtrl.search);
router.patch('/:id/settings', isAuthenticated, checkRateLimit(1, 20), conversationsCtrl.updateSettings);
router.get('/:id/scheduled', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.listScheduled);
router.post('/:id/scheduled', isAuthenticated, checkRateLimit(0.5, 10), audit('SCHEDULED_MESSAGE', 'CREATE'), conversationsCtrl.createScheduled);

module.exports = router;
