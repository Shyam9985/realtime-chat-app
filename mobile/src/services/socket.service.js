import { io } from "socket.io-client";
import { get } from "../store/api.service";
import * as tokenStore from "../storage/tokenStore";
import { API_URL } from "../config";

/*
 * Ported from the web client's services/socket.service.js. The one socket of the app:
 * connect() after login, disconnect() on logout. Reconnects by itself; when the server refuses the
 * handshake with TOKEN_EXPIRED it calls the profile endpoint (the interceptor stores the renewed
 * token) and tries again. Token reads go through tokenStore instead of localStorage.
 */
let socket = null;
const listeners = new Map();      // event -> Set(handler)
const statusListeners = new Set();
let status = "disconnected";

const setStatus = (next) => {
    status = next;
    statusListeners.forEach((fn) => fn(next));
};

export const getStatus = () => status;
export const onStatus = (fn) => { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); };
export const isConnected = () => !!socket?.connected;

export async function connect() {
    const token = await tokenStore.getToken();
    if (!token) return null;
    if (socket) {
        socket.auth = { token };
        if (!socket.connected) socket.connect();
        return socket;
    }
    setStatus("connecting");
    socket = io(API_URL, { auth: { token }, transports: ["websocket"], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", async (error) => {
        const key = error?.data?.statusKey;
        if (key === "TOKEN_EXPIRED") {
            try {
                await get("profile");
                socket.auth = { token: await tokenStore.getToken() };
                socket.connect();
                return;
            } catch (_) { /* a dead session signs the user out through the interceptor */ }
        }
        if (key === "SESSION_EXPIRED" || key === "INVALID_TOKEN" || key === "ACCOUNT_INACTIVE") {
            setStatus("unauthorized");
            socket.disconnect();
            return;
        }
        setStatus("disconnected");
    });

    for (const [event, handlers] of listeners) for (const handler of handlers) socket.on(event, handler);
    return socket;
}

export function disconnect() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    setStatus("disconnected");
}

// subscribe now; the subscription survives reconnects and a socket created later
export function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    if (socket) socket.on(event, handler);
    return () => {
        listeners.get(event)?.delete(handler);
        if (socket) socket.off(event, handler);
    };
}

// emit with acknowledgement; rejects with { statusKey, message } on a server-side error or timeout
export function emitWithAck(event, payload, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        if (!socket?.connected) return reject({ statusKey: "SOCKET_OFFLINE", message: "Not connected." });
        const timer = setTimeout(() => reject({ statusKey: "TIMEOUT", message: "The server did not respond." }), timeoutMs);
        socket.emit(event, payload, (ack) => {
            clearTimeout(timer);
            if (ack?.ok) resolve(ack);
            else reject(ack?.error || { statusKey: "UNKNOWN", message: "Request failed." });
        });
    });
}
