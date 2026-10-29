const express = require("express");
const router = express.Router();
const filesCtrl = require("../controllers/filesCtrl");
const { isAuthenticated } = require("../middleware/authMdlwre");
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');
const { audit } = require("../middleware/auditMdlwre");

router.post("/upload", isAuthenticated, checkRateLimit(0.2, 10), audit("FILE", "UPLOAD", null, "file_id"), filesCtrl.uploadFiles);
router.get("/profile-photo", isAuthenticated, checkRateLimit(1, 60), filesCtrl.getProfilePhoto);
router.delete("/profile-photo", isAuthenticated, checkRateLimit(0.2, 10), audit("FILE", "DELETE"), filesCtrl.removeProfilePhoto);

module.exports = router;
