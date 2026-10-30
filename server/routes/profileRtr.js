const express = require('express');
const router = express.Router();
const authmdlwre = require('../middleware/authMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');
const { audit } = require('../middleware/auditMdlwre');
const profileCtrl = require('../controllers/profileCtrl');

router.get('/', authmdlwre.isAuthenticated, checkRateLimit(1, 60), profileCtrl.getProfile);
router.patch('/', authmdlwre.isAuthenticated, checkRateLimit(0.5, 10), audit('PROFILE', 'UPDATE'), profileCtrl.updateProfile);
// deleting the account is not audited: the audit row would point at the account that no longer exists
router.delete('/', authmdlwre.isAuthenticated, checkRateLimit(0.05, 5), profileCtrl.deleteAccount);

module.exports = router;
