const express = require('express');
const router = express.Router();
const authmdlwre = require('../middleware/authMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');
const profileCtrl = require('../controllers/profileCtrl');

router.get('/', authmdlwre.isAuthenticated, checkRateLimit(1, 60), profileCtrl.getProfile);

module.exports = router;
