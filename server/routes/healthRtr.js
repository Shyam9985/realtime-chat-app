const express = require('express');
const router = express.Router();
const healthCtrl = require('../controllers/healthCtrl');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.get('/', checkRateLimit(1, 10), healthCtrl.check);

module.exports = router;
