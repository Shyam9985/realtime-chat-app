const fs = require('fs');
const groupsMdl = require('../models/groupsMdl');
const fileutils = require('../utils/files.utils');
const filesService = require('./filesService');
const conversationsMdl = require('../models/conversationsMdl');
const usersMdl = require('../models/usersMdl');
const blocksMdl = require('../models/blocksMdl');
const conversationsService = require('./conversationsService');
const messagesService = require('./messagesService');
const resutils = require('../utils/response.utils');
const appEvents = require('../utils/events.utils');
const { toIso } = require('../utils/validate.utils');
// the member limit is a request rule too (how many ids one call may name); one setting for both
const { MAX_MEMBERS } = require('../validators/groupsVldtr');
const { log } = require('../utils/log.utils');

/*
 * Group chats. Any member can read, write and exit; only admins add or remove people, make or dismiss
 * admins and change the group's name and description. A group can have several admins and always
 * keeps at least one while it has members. Every change is announced in the chat by a notice and
 * pushed live to everyone it concerns. The rules that depend on who is in the group right now are
 * checked again inside the locked transaction (groupsMdl), so concurrent changes stay consistent.
 * The request itself (names, id lists, roles) is checked by validators/groupsVldtr before it gets here.
 */
const { GROUP, nameOf } = conversationsService;

let groupTypeId = null;
const getGroupTypeId = async () => {
    if (groupTypeId) return groupTypeId;
    const [row] = await conversationsMdl.getConversationTypeByCode(GROUP);
    if (!row) resutils.createError('DatabaseError', 'Conversation type master is not seeded.');
    groupTypeId = row.conversation_type_id;
    return groupTypeId;
};

// who can actually be put in the group by this person: active accounts with no block between the two,
// in either direction. the others are reported back, without saying why
const addable = async (actorId, userIds) => {
    const active = new Set((await usersMdl.getActiveIdsIn(userIds)).map((r) => r.user_id));
    const blocked = new Set((await blocksMdl.blockedEitherWay(actorId, userIds)).map((r) => r.user_id));
    const ok = userIds.filter((id) => active.has(id) && !blocked.has(id));
    return { ok, skipped: userIds.filter((id) => !ok.includes(id)) };
};

// the refusal reasons groupsMdl returns, as the named errors the controllers map to statuses
const refuse = ({ refused, room }) => {
    if (refused === 'notMember') resutils.createError('notMember', 'You are not a member of this group.');
    if (refused === 'notAdmin') resutils.createError('notAdmin', 'Only group admins can do that.');
    if (refused === 'targetNotMember') resutils.createError('validationFailed', 'That person is not in this group.');
    if (refused === 'lastAdmin') resutils.createError('lastAdmin', 'A group needs at least one admin. Make someone else an admin first, or exit the group.');
    if (refused === 'groupFull') {
        resutils.createError('groupFull', room
            ? `This group has room for ${room} more ${room === 1 ? 'person' : 'people'} (the limit is ${MAX_MEMBERS}).`
            : `This group is full (the limit is ${MAX_MEMBERS} members).`);
    }
    resutils.createError('validationFailed', 'That change is not possible.');
};

// a lock wait lost to a concurrent change (deadlock victim, timeout) is retried before it is reported
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const withRetry = async (run, attempt = 1) => {
    try {
        return await run();
    } catch (error) {
        if (RETRYABLE.has(error.code) && attempt < 3) return withRetry(run, attempt + 1);
        throw error;
    }
};

// the current group membership of the caller: a group, and they are in it
const assertGroupMember = async (conversationId, userId) => {
    const membership = await conversationsService.assertMemberSrvc(conversationId, userId);
    if (membership.type_code !== GROUP) resutils.createError('notGroup', 'This is not a group.');
    return membership;
};

// after a change: the notices go out like messages, every member concerned reloads the group, the
// senders hear about ticks that moved, and a member whose scheduled messages were cancelled is told
const announce = async ({ conversationId, noticeIds = [], notify = [], excludedMessageIds = [], scheduledFor = null }) => {
    for (const id of noticeIds) await messagesService.announceMessage(id);
    if (notify.length) appEvents.emit('group.updated', { conversationId, userIds: [...new Set(notify)] });
    await messagesService.announceStatus(excludedMessageIds);
    if (scheduledFor) appEvents.emit('scheduled.changed', { sender_id: scheduledFor, conversation_id: conversationId });
};

// POST /conversations/groups  { title, description, memberIds } (groupsVldtr.validateCreate)
exports.createSrvc = async (userId, { title, description = null, memberIds: requested }) => {
    log('in group createSrvc');
    const me = Number(userId);
    const { ok, skipped } = await addable(me, requested);
    if (!ok.length) resutils.createError('validationFailed', 'None of the people you chose can be added to a group.');

    const { conversationId, noticeIds } = await groupsMdl.createGroup({
        typeId: await getGroupTypeId(), systemTypeId: await messagesService.getSystemTypeId(), creatorId: me, title, description, memberIds: ok
    });
    appEvents.emit('conversation.created', { conversationId, memberIds: [me, ...ok] });
    await announce({ conversationId, noticeIds });
    return { conversation: await conversationsService.getSummarySrvc(me, conversationId), skipped_user_ids: skipped };
};

// GET /conversations/:id/group  - the group's details and current members (members only)
exports.getGroupSrvc = async (userId, conversationId) => {
    log('in getGroupSrvc');
    const membership = await assertGroupMember(conversationId, userId);
    const [group] = await groupsMdl.getGroup(conversationId);
    const members = await groupsMdl.listMembers(conversationId);
    return {
        group: {
            conversation_id: group.conversation_id,
            title: group.title,
            description: group.description,
            photo_url: group.photo_url ?? null,
            created_at: toIso(group.created_at),
            created_by: { user_id: group.created_by, name: nameOf(group.creator_first_nm, group.creator_last_nm) },
            my_role: membership.member_role,
            max_members: MAX_MEMBERS,
            members: members.map((m) => ({
                user_id: m.user_id, first_nm: m.first_nm, last_nm: m.last_nm, email: m.email, profile_photo_url: m.profile_photo_url,
                role: m.member_role, joined_at: toIso(m.joined_at), is_me: m.user_id === Number(userId)
            }))
        }
    };
};

// POST /conversations/:id/members  { user_ids }  - admins only; requested: unique ids, caller left out
exports.addMembersSrvc = async (userId, conversationId, requested) => {
    log('in addMembersSrvc');
    const me = Number(userId);
    await assertGroupMember(conversationId, me);
    const { ok, skipped } = await addable(me, requested);
    if (!ok.length) resutils.createError('validationFailed', 'None of the people you chose can be added to this group.');

    const result = await withRetry(async () => groupsMdl.addMembers({ conversationId, actorId: me, userIds: ok, maxMembers: MAX_MEMBERS, systemTypeId: await messagesService.getSystemTypeId() }));
    if (result.refused) refuse(result);
    if (result.added.length) {
        appEvents.emit('conversation.created', { conversationId, memberIds: result.added });
        await announce({ conversationId, noticeIds: result.noticeIds, notify: result.memberIds });
    }
    return { added_user_ids: result.added, already_member_ids: result.already, skipped_user_ids: skipped, ...(await exports.getGroupSrvc(me, conversationId)) };
};

// DELETE /conversations/:id/members/:userId  - admins only; exiting yourself is POST /leave
exports.removeMemberSrvc = async (userId, conversationId, targetId) => {
    log('in removeMemberSrvc');
    const me = Number(userId);
    if (targetId === me) resutils.createError('selfAction', 'To leave the group yourself, use Exit group.');
    await assertGroupMember(conversationId, me);

    const result = await withRetry(async () => groupsMdl.removeMember({ conversationId, actorId: me, targetId, systemTypeId: await messagesService.getSystemTypeId() }));
    if (result.refused) refuse(result);
    await announce({
        conversationId, noticeIds: result.noticeIds, notify: [...result.memberIds, targetId],
        excludedMessageIds: result.excludedMessageIds, scheduledFor: result.cancelledScheduled ? targetId : null
    });
    return exports.getGroupSrvc(me, conversationId);
};

// POST /conversations/:id/leave  - any member exits the group (admins too). they keep reading what
// they received, read-only; if they were the last admin, the longest-standing member takes over
exports.leaveSrvc = async (userId, conversationId) => {
    log('in leaveSrvc');
    const me = Number(userId);
    const membership = await conversationsService.assertMemberSrvc(conversationId, me);
    if (membership.type_code !== GROUP) resutils.createError('notGroup', 'You can only exit a group.');

    const result = await withRetry(async () => groupsMdl.leave({ conversationId, userId: me, systemTypeId: await messagesService.getSystemTypeId() }));
    if (result.refused) refuse(result);
    await announce({
        conversationId, noticeIds: result.noticeIds, notify: [...result.memberIds, me],
        excludedMessageIds: result.excludedMessageIds, scheduledFor: result.cancelledScheduled ? me : null
    });
    return { conversation: await conversationsService.getSummarySrvc(me, conversationId), promoted_user_id: result.promotedId };
};

// PATCH /conversations/:id/members/:userId  { role: 'ADMIN' | 'MEMBER' }  - admins only
exports.setRoleSrvc = async (userId, conversationId, targetId, role) => {
    log('in setRoleSrvc');
    const me = Number(userId);
    await assertGroupMember(conversationId, me);

    const result = await withRetry(async () => groupsMdl.setRole({ conversationId, actorId: me, targetId, role, systemTypeId: await messagesService.getSystemTypeId() }));
    if (result.refused) refuse(result);
    if (result.changed) await announce({ conversationId, noticeIds: result.noticeIds, notify: result.memberIds });
    return { changed: result.changed, ...(await exports.getGroupSrvc(me, conversationId)) };
};

// PATCH /conversations/:id/group  { title?, description? }  - admins only
// title / description: undefined = unchanged (at least one is given, see groupsVldtr.validateUpdateInfo)
exports.updateInfoSrvc = async (userId, conversationId, { title, description }) => {
    log('in updateInfoSrvc');
    const me = Number(userId);
    await assertGroupMember(conversationId, me);

    const result = await withRetry(async () => groupsMdl.updateInfo({ conversationId, actorId: me, title, description, systemTypeId: await messagesService.getSystemTypeId() }));
    if (result.refused) refuse(result);
    if (result.changed) await announce({ conversationId, noticeIds: result.noticeIds, notify: result.memberIds });
    return { changed: result.changed, ...(await exports.getGroupSrvc(me, conversationId)) };
};

// DELETE /conversations/:id  - a group the caller already exited leaves their list
exports.deleteSrvc = async (userId, conversationId) => {
    log('in group deleteSrvc');
    const me = Number(userId);
    const membership = await conversationsService.assertReaderSrvc(conversationId, me);
    if (membership.type_code !== GROUP) resutils.createError('notGroup', 'Only a group you have exited can be deleted.');
    if (!membership.left_at) resutils.createError('stillMember', 'Exit the group before deleting it.');
    await groupsMdl.hideExitedGroup(conversationId, me);
    appEvents.emit('conversation.removed', { userId: me, conversationId });
    return { deleted: true };
};

/*
 * The group photo: admins set or remove it, every member (and someone who exited, who keeps the chat)
 * sees it. A new photo goes through the same upload as a profile photo (checked while it streams in,
 * compressed to a JPEG of at most 1 MB) and replaces the old one completely, row and file.
 * The admin check runs first (before any byte is read) and again inside the locked transaction.
 */
const refusePhoto = (result) => {
    if (result.refused === 'noPhoto') resutils.createError('noPhoto', 'This group has no photo.');
    refuse(result);
};

// POST /conversations/:id/photo  (raw image body; meta from filesVldtr.validateUploadMeta)
exports.setPhotoSrvc = async (userId, conversationId, readStream, meta) => {
    log('in group setPhotoSrvc');
    const me = Number(userId);
    const membership = await assertGroupMember(conversationId, me);
    if (membership.member_role !== 'ADMIN') resutils.createError('notAdmin', 'Only group admins can change the group photo.');

    const systemTypeId = await messagesService.getSystemTypeId();
    const result = await filesService.saveStreamedFileSrvc(readStream, { ...meta, uploadedBy: me }, fileutils.GROUP_PHOTO_DIR, {
        entityType: 'GROUP_PHOTO',
        entityId: conversationId,
        persist: async (record) => {
            const saved = await groupsMdl.replaceGroupPhoto({ conversationId, actorId: me, record, systemTypeId });
            if (saved.refused) refusePhoto(saved);     // the upload's files are removed by the caller
            return saved;
        },
    });
    await announce({ conversationId, noticeIds: result.noticeIds, notify: result.memberIds });
    return { photo_url: result.file_path };
};

// DELETE /conversations/:id/photo
exports.removePhotoSrvc = async (userId, conversationId) => {
    log('in group removePhotoSrvc');
    const me = Number(userId);
    await assertGroupMember(conversationId, me);
    const result = await withRetry(async () => groupsMdl.removeGroupPhoto({ conversationId, actorId: me, systemTypeId: await messagesService.getSystemTypeId() }));
    if (result.refused) refusePhoto(result);
    for (const oldPath of result.oldPaths) await fs.promises.unlink(fileutils.resolveStoredPath(oldPath)).catch(() => {});
    await announce({ conversationId, noticeIds: result.noticeIds, notify: result.memberIds });
    return { removed: true };
};

// GET /conversations/:id/photo: the file to stream back
exports.getPhotoSrvc = async (userId, conversationId) => {
    log('in group getPhotoSrvc');
    await conversationsService.assertReaderSrvc(conversationId, userId);
    const [photo] = await groupsMdl.getGroupPhoto(conversationId);
    if (!photo) resutils.createError('noPhoto', 'This group has no photo.');
    const absolutePath = fileutils.resolveStoredPath(photo.file_path);
    try { await fs.promises.access(absolutePath); } catch (_) { resutils.createError('noPhoto', 'The group photo is missing on the server.'); }
    return { absolutePath, mimeType: photo.mime_type, sizeBytes: photo.size_bytes };
};

exports.MAX_MEMBERS = MAX_MEMBERS;
