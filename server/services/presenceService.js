const usersMdl = require('../models/usersMdl');
const appEvents = require('../utils/events.utils');
const { toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * "online" / "last seen". A user is online while at least one of their phones holds a live connection
 * (the app is open); when the last one closes, that moment is saved as last_seen_at. The people they
 * have a one-to-one chat with (and have not blocked, nor been blocked by) hear each change live.
 * The count lives in memory: this server is a single instance, and a restart drops every connection
 * anyway (the phones reconnect and count again).
 */
const connections = new Map();     // user id -> number of open sockets

const announce = async (userId, online, lastSeenAt) => {
    const watchers = (await usersMdl.listPresenceWatchers(userId)).map((r) => r.user_id);
    if (watchers.length) appEvents.emit('presence.changed', { userId, online, lastSeenAt: toIso(lastSeenAt), watchers });
};

exports.isOnline = (userId) => (connections.get(Number(userId)) || 0) > 0;

// a socket of this user connected
exports.connectedSrvc = async (userId) => {
    const id = Number(userId);
    const count = (connections.get(id) || 0) + 1;
    connections.set(id, count);
    if (count === 1) await announce(id, true, null);
};

// a socket of this user disconnected; the last one makes them offline, "last seen" now
exports.disconnectedSrvc = async (userId) => {
    const id = Number(userId);
    const count = Math.max(0, (connections.get(id) || 0) - 1);
    if (count) { connections.set(id, count); return; }
    connections.delete(id);
    await usersMdl.markLastSeen(id);
    const [row] = await usersMdl.getLastSeen(id);
    log(`[presence] user ${id} offline`);
    await announce(id, false, row?.last_seen_at || new Date());
};
