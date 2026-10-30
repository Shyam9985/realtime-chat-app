
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authCtrl');
const authmdlwre = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

// sign-up: limited per email (the account being created) plus a generous per-ip cap. a per-ip limit alone
// blocked everyone sharing one public ip (a home wi-fi, a mobile carrier) after a few sign-ups
router.post('/signup', checkRateLimit(100 / 3600, 100), checkRateLimit(3 / 3600, 3, { by: 'email' }), audit('USER', 'SIGNUP'), authCtrl.signUp);
router.post('/login', checkRateLimit(5 / 900, 5), audit('USER', 'LOGIN'), authCtrl.logIn);
router.post('/logout', checkRateLimit(0.5, 10), audit('USER', 'LOGOUT'), authCtrl.logOut);
router.get('/reset-password/send-email', authmdlwre.isAuthenticated, checkRateLimit(3 / 3600, 3), audit('USER', 'RESET_PASSWORD_EMAIL'), authCtrl.sendResetPasswordEmail);
router.post('/email/verify-otp', checkRateLimit(5 / 900, 5), audit('USER', 'VERIFY_OTP'), authCtrl.verifyEmailOtp);
router.post('/forgot-password', checkRateLimit(3 / 3600, 3), audit('USER', 'FORGOT_PASSWORD'), authCtrl.forgotPassword);
router.post('/update-password', checkRateLimit(5 / 900, 5), audit('USER', 'UPDATE_PASSWORD'), authCtrl.updatePassword);


module.exports = router;