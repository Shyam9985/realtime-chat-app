const express = require('express');
const router = express.Router();
const authmdlwre = require('../middleware/authMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');
const { audit } = require('../middleware/auditMdlwre');
const profileCtrl = require('../controllers/profileCtrl');

router.get('/', authmdlwre.isAuthenticated, checkRateLimit(1, 60), profileCtrl.getProfile);
router.patch('/', authmdlwre.isAuthenticated, checkRateLimit(0.5, 10), audit('PROFILE', 'UPDATE'), profileCtrl.updateProfile);

module.exports = router;
