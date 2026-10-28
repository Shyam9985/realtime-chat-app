const express = require('express');
const router = express.Router();
const devicesCtrl = require('../controllers/devicesCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

// the app sends its push token at every start and sign-in, and withdraws it at sign-out
router.post('/', isAuthenticated, checkRateLimit(0.5, 10), devicesCtrl.register);
router.post('/unregister', isAuthenticated, checkRateLimit(0.5, 10), devicesCtrl.unregister);

module.exports = router;
