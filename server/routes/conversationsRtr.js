const express = require('express');
const router = express.Router();
const conversationsCtrl = require('../controllers/conversationsCtrl');
const keysCtrl = require('../controllers/keysCtrl');
const { isAuthenticated } = require('../middleware/authMdlwre');
const { audit } = require('../middleware/auditMdlwre');
const { checkRateLimit } = require('../middleware/rateLimitmdlwre');

router.get('/', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.list);
router.post('/read-all', isAuthenticated, checkRateLimit(0.2, 5), audit('CONVERSATION', 'READ_ALL'), conversationsCtrl.readAll);
router.post('/', isAuthenticated, checkRateLimit(1, 10), audit('CONVERSATION', 'CREATE'), conversationsCtrl.getOrCreate);
router.post('/groups', isAuthenticated, checkRateLimit(0.5, 10), audit('GROUP', 'CREATE'), conversationsCtrl.createGroup);
router.get('/:id', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.getOne);
router.delete('/:id', isAuthenticated, checkRateLimit(1, 10), audit('GROUP', 'DELETE'), conversationsCtrl.deleteGroup);
router.get('/:id/group', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.getGroup);
router.patch('/:id/group', isAuthenticated, checkRateLimit(1, 10), audit('GROUP', 'UPDATE'), conversationsCtrl.updateGroup);
router.post('/:id/members', isAuthenticated, checkRateLimit(1, 10), audit('GROUP', 'ADD_MEMBERS'), conversationsCtrl.addMembers);
router.delete('/:id/members/:userId', isAuthenticated, checkRateLimit(1, 10), audit('GROUP', 'REMOVE_MEMBER'), conversationsCtrl.removeMember);
router.patch('/:id/members/:userId', isAuthenticated, checkRateLimit(1, 10), audit('GROUP', 'SET_ROLE'), conversationsCtrl.setMemberRole);
// the group photo: admins set or remove it, members (and people who exited) see it
router.get('/:id/photo', isAuthenticated, checkRateLimit(5, 120), conversationsCtrl.getGroupPhoto);
router.post('/:id/photo', isAuthenticated, checkRateLimit(0.2, 10), audit('GROUP', 'SET_PHOTO'), conversationsCtrl.setGroupPhoto);
router.delete('/:id/photo', isAuthenticated, checkRateLimit(0.2, 10), audit('GROUP', 'REMOVE_PHOTO'), conversationsCtrl.removeGroupPhoto);
router.post('/:id/leave', isAuthenticated, checkRateLimit(1, 10), audit('GROUP', 'LEAVE'), conversationsCtrl.leaveGroup);
router.get('/:id/messages', isAuthenticated, checkRateLimit(5, 60), conversationsCtrl.history);
router.post('/:id/seen', isAuthenticated, checkRateLimit(5, 60), conversationsCtrl.markSeen);
// the chat key: its current version and the members' padlocks; a new version (one locked copy per member)
router.get('/:id/keys', isAuthenticated, checkRateLimit(2, 30), keysCtrl.keyState);
router.post('/:id/keys', isAuthenticated, checkRateLimit(1, 20), audit('CONVERSATION', 'NEW_KEY'), keysCtrl.createConversationKey);
router.patch('/:id/settings', isAuthenticated, checkRateLimit(1, 20), conversationsCtrl.updateSettings);
router.get('/:id/scheduled', isAuthenticated, checkRateLimit(2, 30), conversationsCtrl.listScheduled);
router.post('/:id/scheduled', isAuthenticated, checkRateLimit(0.5, 10), audit('SCHEDULED_MESSAGE', 'CREATE'), conversationsCtrl.createScheduled);

module.exports = router;
