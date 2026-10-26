// Ported from the web client's utils/chatFormat.js
const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// the http interceptor already turns ISO strings into Date objects; socket payloads arrive as strings
const asDate = (v) => (v instanceof Date ? v : new Date(v));

export const timeOf = (v) => { if (!v) return ""; const d = asDate(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const listStamp = (v) => {
    if (!v) return "";
    const d = asDate(v); const now = new Date();
    if (sameDay(d, now)) return timeOf(d);
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return "Yesterday";
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
};

export const dayLabel = (v) => {
    const d = asDate(v); const now = new Date();
    if (sameDay(d, now)) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return "Yesterday";
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const isSameDay = (a, b) => sameDay(asDate(a), asDate(b));
export const fullName = (u) => [u?.first_nm, u?.last_nm].filter(Boolean).join(" ") || u?.email || "Unknown";
export const initials = (u) => fullName(u).split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
export const minutesSince = (v) => (Date.now() - asDate(v).getTime()) / 60000;
export const DELETED_PLACEHOLDER = "This message was deleted";
export const MESSAGE_MAX_LENGTH = 2000;
export const DELETE_WINDOW_MINUTES = 15;
