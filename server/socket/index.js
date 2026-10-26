const { Server } = require('socket.io');
const { socketAuth } = require('./socket.auth');
const { registerHandlers } = require('./socket.handlers');
const { registerRelay, room } = require('./socket.relay');
const messagesService = require('../services/messagesService');
const { logBlock } = require('../utils/log.utils');

/*
 * Attaches Socket.IO to the http server. Same cors allow-list as the rest api.
 *
 * on connect: the socket joins its user's room, pending receipts are marked delivered (the user
 * is demonstrably reachable now - FR-011/FR-012) and the event handlers are registered.
 */
const initSocket = (httpServer, { allowedOrigins }) => {
    const io = new Server(httpServer, {
        cors: { origin: allowedOrigins, credentials: true, allowedHeaders: ['access-token'] },
        // a dropped client is noticed within ~25s and its socket cleaned up
        pingInterval: 20000,
        pingTimeout: 5000,
        maxHttpBufferSize: 64 * 1024
    });

    io.use(socketAuth);
    registerRelay(io);

    io.on('connection', async (socket) => {
        const userId = socket.data.user.user_id;
        socket.join(room(userId));
        logBlock('[socket] connected:', `user ${userId} socket ${socket.id}`);

        registerHandlers(io, socket);

        try {
            const count = await messagesService.markPendingDeliveredSrvc(userId);
            if (count) logBlock('[socket] offline recovery:', `${count} message(s) marked delivered for user ${userId}`);
        } catch (error) {
            console.error('[socket] offline delivery sweep failed:', error.message);
        }
    });

    return io;
};

module.exports = { initSocket };
