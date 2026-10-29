const messagesService = require('../services/messagesService');
const messagesVldtr = require('../validators/messagesVldtr');
const { statusForError, clientMessageForError } = require('../utils/chat.errors');
const rateLimit = require('./socket.ratelimit');
const { log } = require('../utils/log.utils');

// message:send bursts: 30 at once, then 5 per second. every attempt costs a token, valid or not,
// so a client hammering the server with bad payloads is slowed down just the same
const SEND_CAPACITY = 30;
const SEND_REFILL_PER_SECOND = 5;

const toErrorPayload = (error, event) => {
    const status = statusForError(error);
    return { event, statusKey: status.statusKey, code: status.code, message: clientMessageForError(error) };
};

// each handler answers the ack callback (when the client passed one) and, on failure, also emits
// the structured 'error' event from SRS 6.2 so clients that do not use acks still hear about it
const wrap = (socket, event, handler) => async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
        const result = await handler(payload || {});
        reply({ ok: true, ...result });
    } catch (error) {
        console.log(`[socket] ${event} failed for user ${socket.data.user.user_id}:`, error?.message || error);
        const body = toErrorPayload(error, event);
        reply({ ok: false, error: body });
        socket.emit('error', body);
    }
};

const rateLimited = () => {
    const error = new Error('You are sending messages too quickly. Please slow down.');
    error.name = 'rateLimited';
    throw error;
};

const registerHandlers = (io, socket) => {
    const userId = socket.data.user.user_id;

    // message:send { conversation_id, content, client_message_id? } -> ack { ok, message, duplicate }
    // the sender is the socket's user; a sender_id in the payload is ignored
    // sends from one socket are processed one after another: the limiter answers immediately, the
    // accepted ones queue behind each other so a client's messages are stored in the order it sent
    // them and a burst does not open dozens of transactions at once
    socket.data.sendQueue = Promise.resolve();
    socket.on('message:send', wrap(socket, 'message:send', async (payload) => {
        if (!rateLimit.take(`send:${userId}`, SEND_CAPACITY, SEND_REFILL_PER_SECOND)) rateLimited();
        // a socket handler is the controller here: the payload is checked before it joins the queue
        const send = messagesVldtr.validateSend(payload);
        const run = socket.data.sendQueue.then(() => messagesService.sendSrvc(userId, send));
        socket.data.sendQueue = run.catch(() => {});
        const { message, duplicate } = await run;
        return { message, duplicate };
    }));

    // message:delivered { message_id }
    socket.on('message:delivered', wrap(socket, 'message:delivered', async (payload) => {
        return messagesService.markDeliveredSrvc(userId, messagesVldtr.messageId(payload.message_id));
    }));

    // message:seen { conversation_id } - the user viewed the conversation
    socket.on('message:seen', wrap(socket, 'message:seen', async (payload) => {
        return messagesService.markSeenSrvc(userId, messagesVldtr.conversationId(payload.conversation_id));
    }));

    socket.on('disconnect', (reason) => log(`[socket] user ${userId} disconnected: ${reason}`));
};

module.exports = { registerHandlers };
