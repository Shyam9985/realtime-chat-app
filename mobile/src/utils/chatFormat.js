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

// "Today, 14:05" / "Yesterday, 09:30" / "12 Oct 2026, 18:00", for message info
export const fullStamp = (v) => (v ? `${dayLabel(v)}, ${timeOf(v)}` : null);
export const isSameDay = (a, b) => sameDay(asDate(a), asDate(b));
export const fullName = (u) => [u?.first_nm, u?.last_nm].filter(Boolean).join(" ") || u?.email || "Unknown";
export const initials = (u) => fullName(u).split(" ").slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
export const minutesSince = (v) => (Date.now() - asDate(v).getTime()) / 60000;
export const DELETED_PLACEHOLDER = "This message was deleted";
export const MESSAGE_MAX_LENGTH = 2000;
export const DELETE_WINDOW_MINUTES = 15;
// the server's GROUP_MAX_MEMBERS default (you included); the server has the final say
export const GROUP_MAX_MEMBERS = 100;

// ---- groups
export const isGroup = (conversation) => conversation?.conversation_type === "GROUP";
export const isNotice = (message) => message?.message_type === "SYSTEM";
export const firstName = (name) => (name || "").split(" ")[0] || name || "";

// a group notice in words, for the person reading it: "You added Noah", "Maya added you", "You left"
export const noticeText = (m, myId) => {
    const byMe = m.sender_id === myId;
    const actor = byMe ? "You" : m.sender_name || "Someone";
    const aboutMe = m.system_target_user_id === myId;
    const target = aboutMe ? "you" : m.system_target_name || "someone";
    switch (m.system_event) {
        case "GROUP_CREATED": return `${actor} created the group “${m.content}”`;
        case "MEMBER_ADDED": return `${actor} added ${target}`;
        case "MEMBER_REMOVED": return `${actor} removed ${target}`;
        case "MEMBER_LEFT": return `${actor} left`;
        case "ADMIN_MADE": return `${actor} made ${target} an admin`;
        case "ADMIN_DISMISSED": return `${actor} dismissed ${target} as admin`;
        case "ADMIN_ASSIGNED": return aboutMe ? "You’re now an admin" : `${m.system_target_name || "Someone"} is now an admin`;
        case "NAME_CHANGED": return `${actor} changed the group name to “${m.content}”`;
        case "DESCRIPTION_CHANGED": return `${actor} changed the group description`;
        case "PHOTO_CHANGED": return `${actor} changed the group photo`;
        case "PHOTO_REMOVED": return `${actor} removed the group photo`;
        default: return m.content || "";
    }
};

// ---- dates of birth ('YYYY-MM-DD', the phone's own calendar day: no time zone can move it)
export const toDateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDateValue = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
// "15 May 1995"
export const birthDateLabel = (value) => {
    const d = fromDateValue(value);
    return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "";
};

// ---- presence: "Online" while their app is open, otherwise "last active today at 14:05"
export const presenceLabel = (presence) => {
    if (!presence) return null;
    if (presence.online) return "Online";
    if (!presence.last_seen_at) return null;
    const d = asDate(presence.last_seen_at); const now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    const day = sameDay(d, now) ? "today" : sameDay(d, y) ? "yesterday"
        : `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
    return `last active ${day} at ${timeOf(d)}`;
};
