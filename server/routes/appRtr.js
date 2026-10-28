const express = require('express');
const router = express.Router();
const appCtrl = require('../controllers/appCtrl');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');
const { audit } = require('../middleware/auditMdlwre');

// no sign-in: the app checks at every start, the login screen included, so a mandatory update can
// stop an old build before it talks to anything else
router.get('/latest', checkRateLimit(1, 30), appCtrl.latest);
// the release script, with the release key (no user sign-in: it is the developer's tool, not a user's)
router.post('/releases', checkRateLimit(0.2, 5), audit('APP', 'PUBLISH_RELEASE'), appCtrl.publish);

module.exports = router;
