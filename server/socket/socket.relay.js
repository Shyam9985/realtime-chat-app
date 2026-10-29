const appEvents = require('../utils/events.utils');
const { log } = require('../utils/log.utils');

/*
 * The services announce what happened on the app event bus; this module turns those announcements
 * into socket events for the users concerned. The services never know sockets exist, so the same
 * code path serves a message sent over rest, over a socket, or from a future worker.
 *
 * every connected socket of a user sits in the room 'user:<id>', so a user with two devices
 * hears everything on both.
 */
const room = (userId) => `user:${userId}`;

const registerRelay = (io) => {
    // SRS 6.2 message:new to each recipient, message:sent to the sender's other devices
    appEvents.on('message.created', ({ message, recipientIds, senderId }) => {
        log(`[relay] message ${message.message_id} -> recipients ${recipientIds.join(',')}`);
        for (const id of recipientIds) io.to(room(id)).emit('message:new', message);
        io.to(room(senderId)).emit('message:sent', message);
    });

    appEvents.on('message.delivered', (receipt) => {
        io.to(room(receipt.sender_id)).emit('message:delivered', {
            message_id: receipt.message_id, conversation_id: receipt.conversation_id,
            user_id: receipt.user_id, delivered_at: receipt.delivered_at
        });
    });

    appEvents.on('conversation.seen', ({ conversation_id, user_id, seen_at, message_ids, sender_ids }) => {
        for (const id of sender_ids) io.to(room(id)).emit('message:seen', { conversation_id, user_id, seen_at, message_ids });
    });

    // FR-024: every member hears about the placeholder, including the deleting user's other devices
    appEvents.on('message.deleted', ({ message, memberIds }) => {
        for (const id of memberIds) {
            io.to(room(id)).emit('message:deleted', {
                message_id: message.message_id, conversation_id: message.conversation_id, deleted_at: message.deleted_at
            });
        }
    });

    // an edited message: every member sees the new text and the "Edited" label live
    appEvents.on('message.edited', ({ message, memberIds }) => {
        for (const id of memberIds) io.to(room(id)).emit('message:edited', message);
    });

    // pin / archive / rename are personal: only this member's own devices hear about them
    appEvents.on('conversation.updated', ({ userId, conversation }) => {
        io.to(room(userId)).emit('conversation:updated', conversation);
    });

    // the sender's scheduled list for a conversation changed (created, edited, cancelled, sent, failed)
    appEvents.on('scheduled.changed', ({ sender_id, conversation_id }) => {
        io.to(room(sender_id)).emit('scheduled:changed', { conversation_id });
    });

    appEvents.on('conversation.created', ({ conversationId, memberIds }) => {
        for (const id of memberIds) io.to(room(id)).emit('conversation:new', { conversation_id: conversationId });
    });

    // a group's members, roles, name or description changed: everyone concerned (the members, and the
    // person who was removed or exited) reloads it, so a removed member's chat turns read-only at once
    appEvents.on('group.updated', ({ conversationId, userIds }) => {
        for (const id of userIds) io.to(room(id)).emit('group:updated', { conversation_id: conversationId });
    });

    // someone came online or went offline: the people with a one-to-one chat with them update the header
    appEvents.on('presence.changed', ({ userId, online, lastSeenAt, watchers }) => {
        for (const id of watchers) io.to(room(id)).emit('presence:update', { user_id: userId, online, last_seen_at: lastSeenAt });
    });

    // an exited group deleted from this user's list (their other devices drop it too)
    appEvents.on('conversation.removed', ({ userId, conversationId }) => {
        io.to(room(userId)).emit('conversation:removed', { conversation_id: conversationId });
    });
};

module.exports = { registerRelay, room };
