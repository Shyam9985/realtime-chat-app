
const express = require('express');
const router = express.Router();
const authRtr = require('./authRtr');
const filesRouter = require('./filesRtr');
const profileRtr = require('./profileRtr');
const usersRtr = require('./usersRtr');
const conversationsRtr = require('./conversationsRtr');
const messagesRtr = require('./messagesRtr');
const healthRtr = require('./healthRtr');

router.use('/health', healthRtr);
router.use('/auth', authRtr);
router.use('/files', filesRouter);
router.use('/profile', profileRtr);
// chat
router.use('/users', usersRtr);
router.use('/conversations', conversationsRtr);
router.use('/messages', messagesRtr);

module.exports = router;
