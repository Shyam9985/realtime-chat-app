const express = require('express');
const router = express.Router();
const keysCtrl = require('../controllers/keysCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

// end-to-end encryption: the caller's own keys, other users' padlocks, the caller's locked chat keys
router.get('/me', isAuthenticated, checkRateLimit(1, 20), keysCtrl.getMine);
router.put('/me', isAuthenticated, checkRateLimit(0.05, 5), audit('KEYS', 'SET'), keysCtrl.setMine);
router.patch('/me/password-backup', isAuthenticated, checkRateLimit(0.2, 5), audit('KEYS', 'PASSWORD_BACKUP'), keysCtrl.updatePasswordBackup);
router.put('/me/recovery', isAuthenticated, checkRateLimit(0.05, 5), audit('KEYS', 'RECOVERY_CODE'), keysCtrl.updateRecovery);
router.get('/users', isAuthenticated, checkRateLimit(2, 30), keysCtrl.publicKeys);
router.get('/conversations', isAuthenticated, checkRateLimit(2, 30), keysCtrl.myConversationKeys);

module.exports = router;
