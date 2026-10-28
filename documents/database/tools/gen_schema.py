# Single source of truth for the chat_application schema.
# Run from anywhere:  python documents/database/tools/gen_schema.py
# Emits into documents/database/: schema-v1.sql (DDL + master seeds), chat-app-erd-v2.svg (diagram),
# chat_application_model_v2.mwb (Workbench model, built on the v1 model's document skeleton).
# The png is a browser screenshot of the svg; regenerate it after any change.
import re, uuid, sqlite3, zipfile, shutil, os, sys, tempfile
from xml.sax.saxutils import escape as xesc

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(OUT, "..", ".."))
SCRATCH = tempfile.mkdtemp(prefix="chat-schema-")
MWB_SRC = os.path.join(SCRATCH, "mwb")
with zipfile.ZipFile(os.path.join(OUT, "chat_application_model_v1.mwb")) as z:
    z.extractall(MWB_SRC)
SCHEMA = "chat_application"
COLLATION = "utf8mb4_0900_ai_ci"

# ----------------------------------------------------------------------------- schema definition
def C(name, typ, null=True, default=None, ai=False, comment=""):
    return dict(name=name, type=typ, null=null, default=default, ai=ai, comment=comment)

def STD(precision=None):
    p = f"({precision})" if precision else ""
    return [
        C("is_active", "TINYINT(1)", False, "1", comment="1 = active, 0 = soft deleted"),
        C("created_at", f"DATETIME{p}", False, f"CURRENT_TIMESTAMP{p}"),
        C("updated_at", f"DATETIME{p}", False, f"CURRENT_TIMESTAMP{p} ON UPDATE CURRENT_TIMESTAMP{p}"),
    ]

ID = "BIGINT UNSIGNED"
TABLES = []
def T(name, group, comment, cols, pk, uniques=(), indexes=(), fks=(), checks=(), seeds=None, layout=(0, 0), fulltexts=()):
    TABLES.append(dict(name=name, group=group, comment=comment, cols=cols, pk=pk, uniques=list(uniques),
                       indexes=list(indexes), fks=list(fks), checks=list(checks), seeds=seeds, layout=layout, fulltexts=list(fulltexts)))

# fks: (name, [cols], ref_table, [ref_cols], on_delete, deferred)
T("users_lst_t", "core", "accounts; user_nm holds the login id (the email)", [
    C("user_id", ID, False, ai=True),
    C("user_nm", "VARCHAR(255)", False, comment="login id, the email at signup"),
    C("email", "VARCHAR(255)", False),
    C("first_nm", "VARCHAR(100)", False),
    C("last_nm", "VARCHAR(100)"),
    C("mobile_no", "VARCHAR(15)"),
    C("date_of_birth", "DATE", comment="asked at sign-up; private to the user"),
    C("password_hash", "VARCHAR(255)", False),
    C("password_salt", "VARCHAR(255)"),
    C("profile_photo_url", "VARCHAR(500)"),
    C("last_login", "DATETIME"),
    C("is_locked", "TINYINT(1)", False, "0"),
    C("login_attempts", "INT UNSIGNED", False, "0"),
    C("locked_until", "DATETIME"),
    *STD()], "user_id",
    uniques=[("uq_users_user_nm", ["user_nm"]), ("uq_users_email", ["email"])],
    indexes=[("idx_users_name", ["first_nm", "last_nm"]), ("idx_users_mobile", ["mobile_no"])],
    layout=(40, 60))

T("conversations_type_master_t", "master", "ONE_TO_ONE | GROUP", [
    C("conversation_type_id", "INT UNSIGNED", False, ai=True),
    C("type_code", "VARCHAR(20)", False),
    C("type_name", "VARCHAR(50)", False),
    *STD()], "conversation_type_id",
    uniques=[("uq_conv_type_code", ["type_code"])],
    seeds=[("conversation_type_id", "type_code", "type_name"), (1, "ONE_TO_ONE", "One to one"), (2, "GROUP", "Group")],
    layout=(1480, 60))

T("message_type_master_t", "master", "TEXT | EMOJI | IMAGE | VIDEO | AUDIO | FILE | SYSTEM", [
    C("message_type_id", "INT UNSIGNED", False, ai=True),
    C("type_code", "VARCHAR(20)", False),
    C("type_name", "VARCHAR(50)", False),
    *STD()], "message_type_id",
    uniques=[("uq_msg_type_code", ["type_code"])],
    seeds=[("message_type_id", "type_code", "type_name"),
           (1, "TEXT", "Text"), (2, "EMOJI", "Emoji"), (3, "IMAGE", "Image"), (4, "VIDEO", "Video"),
           (5, "AUDIO", "Audio"), (6, "FILE", "File"), (7, "SYSTEM", "System notice")],
    layout=(1480, 400))

T("conversations_lst_t", "chat", "one row per chat; user_pair_key makes a one-to-one chat unique per pair", [
    C("conversation_id", ID, False, ai=True),
    C("conversation_type_id", "INT UNSIGNED", False),
    C("title", "VARCHAR(100)", comment="group name; null for one-to-one"),
    C("description", "VARCHAR(500)", comment="group description; null for one-to-one"),
    C("created_by", ID, False),
    C("user_pair_key", "VARCHAR(41)", comment="'lowUserId:highUserId' for ONE_TO_ONE, null for groups"),
    C("last_message_id", ID, comment="denormalised for the conversation list"),
    C("last_message_at", "DATETIME(3)"),
    *STD()], "conversation_id",
    uniques=[("uq_conv_user_pair", ["user_pair_key"])],
    indexes=[("idx_conv_last_message_at", ["last_message_at"])],
    fks=[("fk_conv_type", ["conversation_type_id"], "conversations_type_master_t", ["conversation_type_id"], "NO ACTION", False),
         ("fk_conv_created_by", ["created_by"], "users_lst_t", ["user_id"], "NO ACTION", False),
         ("fk_conv_last_message", ["last_message_id"], "messages_lst_t", ["message_id"], "SET NULL", True)],
    layout=(1000, 60))

T("conversation_members_t", "chat", "who is in a conversation; last_read_message_id drives unread counts", [
    C("conversation_member_id", ID, False, ai=True),
    C("conversation_id", ID, False),
    C("user_id", ID, False),
    C("member_role", "VARCHAR(20)", False, "'MEMBER'", comment="MEMBER | ADMIN (groups)"),
    C("last_read_message_id", ID),
    C("last_message_id", ID, comment="newest message this member can see; their list preview and order"),
    C("is_pinned", "TINYINT(1)", False, "0", comment="1 = pinned to the top of this member's chat list"),
    C("pinned_at", "DATETIME(3)", comment="when pinned; orders pinned chats"),
    C("is_archived", "TINYINT(1)", False, "0", comment="1 = shown in this member's archive instead of the list"),
    C("archived_at", "DATETIME(3)"),
    C("custom_title", "VARCHAR(100)", comment="the name this member sees; one-to-one: the other person's name at creation, renamable"),
    C("joined_at", "DATETIME", False, "CURRENT_TIMESTAMP"),
    C("left_at", "DATETIME"),
    *STD()], "conversation_member_id",
    uniques=[("uq_member_conv_user", ["conversation_id", "user_id"])],
    indexes=[("idx_member_user", ["user_id"]), ("idx_member_user_list", ["user_id", "is_archived", "is_pinned", "pinned_at"])],
    fks=[("fk_member_conversation", ["conversation_id"], "conversations_lst_t", ["conversation_id"], "NO ACTION", False),
         ("fk_member_user", ["user_id"], "users_lst_t", ["user_id"], "NO ACTION", False),
         ("fk_member_last_read", ["last_read_message_id"], "messages_lst_t", ["message_id"], "SET NULL", True),
         ("fk_member_last_message", ["last_message_id"], "messages_lst_t", ["message_id"], "SET NULL", True)],
    layout=(520, 60))

T("messages_lst_t", "chat", "messages; soft delete via is_deleted within the 15 minute window", [
    C("message_id", ID, False, ai=True),
    C("conversation_id", ID, False),
    C("sender_id", ID, False),
    C("message_type_id", "INT UNSIGNED", False, "1"),
    C("system_event", "VARCHAR(30)", comment="SYSTEM notices: GROUP_CREATED | MEMBER_ADDED | MEMBER_REMOVED | MEMBER_LEFT | ADMIN_MADE | ADMIN_DISMISSED | ADMIN_ASSIGNED | NAME_CHANGED | DESCRIPTION_CHANGED"),
    C("system_target_user_id", ID, comment="SYSTEM notices: the member the notice is about"),
    C("content", "TEXT"),
    C("attachment_file_id", ID, comment="uploaded_files_lst_t.file_id for image / file messages"),
    C("reply_to_message_id", ID, comment="the message this one quotes (swipe to reply)"),
    C("forwarded_from_message_id", ID, comment="the message this one is a forwarded copy of"),
    C("client_message_id", "CHAR(36)", comment="uuid from the sender; makes a socket retry idempotent"),
    C("is_edited", "TINYINT(1)", False, "0", comment="1 = content changed after sending; history in message_edits_t"),
    C("edited_at", "DATETIME(3)", comment="time of the latest edit"),
    C("is_deleted", "TINYINT(1)", False, "0"),
    C("deleted_at", "DATETIME(3)"),
    *STD(3)], "message_id",
    uniques=[("uq_msg_sender_client", ["sender_id", "client_message_id"])],
    indexes=[("idx_msg_conv_created", ["conversation_id", "created_at", "message_id"])],
    fks=[("fk_msg_conversation", ["conversation_id"], "conversations_lst_t", ["conversation_id"], "NO ACTION", False),
         ("fk_msg_sender", ["sender_id"], "users_lst_t", ["user_id"], "NO ACTION", False),
         ("fk_msg_type", ["message_type_id"], "message_type_master_t", ["message_type_id"], "NO ACTION", False),
         ("fk_msg_attachment", ["attachment_file_id"], "uploaded_files_lst_t", ["file_id"], "SET NULL", False),
         ("fk_msg_reply_to", ["reply_to_message_id"], "messages_lst_t", ["message_id"], "SET NULL", False),
         ("fk_msg_forwarded_from", ["forwarded_from_message_id"], "messages_lst_t", ["message_id"], "SET NULL", False),
         ("fk_msg_system_target", ["system_target_user_id"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    fulltexts=[("ft_msg_content", ["content"])],
    layout=(1000, 400))

T("message_edits_t", "chat", "previous versions of edited messages", [
    C("message_edit_id", ID, False, ai=True),
    C("message_id", ID, False),
    C("old_content", "TEXT", comment="the text before this edit"),
    C("edited_by", ID, False, comment="always the sender; kept for audits"),
    C("edited_at", "DATETIME(3)", False, "CURRENT_TIMESTAMP(3)"),
    *STD(3)], "message_edit_id",
    indexes=[("idx_edit_message", ["message_id", "edited_at"])],
    fks=[("fk_edit_message", ["message_id"], "messages_lst_t", ["message_id"], "NO ACTION", False),
         ("fk_edit_user", ["edited_by"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    layout=(40, 620))

T("scheduled_messages_t", "chat", "messages scheduled for a later date and time", [
    C("scheduled_message_id", ID, False, ai=True),
    C("conversation_id", ID, False),
    C("sender_id", ID, False),
    C("content", "TEXT", False),
    C("reply_to_message_id", ID),
    C("send_at", "DATETIME(3)", False, comment="date and time to send, server time"),
    C("status", "VARCHAR(20)", False, "'PENDING'", comment="PENDING | SENDING | SENT | CANCELLED | FAILED"),
    C("sent_message_id", ID, comment="the message created when it was sent"),
    C("failure_reason", "VARCHAR(255)", comment="e.g. blocked by the recipient"),
    *STD(3)], "scheduled_message_id",
    indexes=[("idx_sched_due", ["status", "send_at"]), ("idx_sched_conv_sender", ["conversation_id", "sender_id", "status"])],
    fks=[("fk_sched_conversation", ["conversation_id"], "conversations_lst_t", ["conversation_id"], "NO ACTION", False),
         ("fk_sched_sender", ["sender_id"], "users_lst_t", ["user_id"], "NO ACTION", False),
         ("fk_sched_sent_msg", ["sent_message_id"], "messages_lst_t", ["message_id"], "SET NULL", False),
         ("fk_sched_reply", ["reply_to_message_id"], "messages_lst_t", ["message_id"], "SET NULL", False)],
    layout=(520, 640))

T("message_receipts_t", "chat", "one row per recipient per message (groups have many)", [
    C("message_receipt_id", ID, False, ai=True),
    C("message_id", ID, False),
    C("user_id", ID, False, comment="the recipient"),
    C("delivered_at", "DATETIME(3)"),
    C("seen_at", "DATETIME(3)"),
    C("excluded_at", "DATETIME(3)", comment="set when the recipient left the group before seeing it; ticks stop waiting for them"),
    *STD(3)], "message_receipt_id",
    uniques=[("uq_receipt_msg_user", ["message_id", "user_id"])],
    indexes=[("idx_receipt_user_seen", ["user_id", "seen_at"])],
    fks=[("fk_receipt_message", ["message_id"], "messages_lst_t", ["message_id"], "NO ACTION", False),
         ("fk_receipt_user", ["user_id"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    layout=(520, 416))

T("user_blocks_t", "chat", "blocker -> blocked; unblock sets is_active = 0", [
    C("block_id", ID, False, ai=True),
    C("blocker_id", ID, False),
    C("blocked_id", ID, False),
    *STD()], "block_id",
    uniques=[("uq_block_pair", ["blocker_id", "blocked_id"])],
    indexes=[("idx_block_blocked", ["blocked_id"])],
    fks=[("fk_block_blocker", ["blocker_id"], "users_lst_t", ["user_id"], "NO ACTION", False),
         ("fk_block_blocked", ["blocked_id"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    checks=[("chk_block_not_self", "blocker_id <> blocked_id")],
    layout=(40, 400))

T("uploaded_files_lst_t", "auth", "files saved by the upload endpoint", [
    C("file_id", ID, False, ai=True),
    C("original_nm", "VARCHAR(255)", False),
    C("stored_nm", "VARCHAR(255)", False),
    C("file_path", "VARCHAR(500)", False),
    C("extension", "VARCHAR(20)"),
    C("mime_type", "VARCHAR(100)", False),
    C("size_bytes", "BIGINT UNSIGNED", False),
    C("checksum_sha256", "CHAR(64)"),
    C("entity_type", "VARCHAR(50)", comment="e.g. USER_PROFILE, MESSAGE"),
    C("entity_id", "VARCHAR(64)"),
    C("uploaded_by", ID, False),
    *STD()], "file_id",
    uniques=[("uq_files_stored_nm", ["stored_nm"])],
    indexes=[("idx_files_entity", ["entity_type", "entity_id", "is_active"])],
    fks=[("fk_files_uploaded_by", ["uploaded_by"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    layout=(1480, 620))

T("user_sessions_t", "auth", "application sessions issued at login", [
    C("id", ID, False, ai=True),
    C("session_id", "VARCHAR(128)", False),
    C("user_id", ID, False),
    C("login_timestamp", "DATETIME", False, "CURRENT_TIMESTAMP"),
    C("last_activity_timestamp", "DATETIME", False, "CURRENT_TIMESTAMP"),
    C("expires_at", "DATETIME", False),
    C("destroyed_at", "DATETIME"),
    *STD()], "id",
    uniques=[("uq_sessions_session_id", ["session_id"])],
    indexes=[("idx_sessions_user", ["user_id", "is_active"])],
    fks=[("fk_sessions_user", ["user_id"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    layout=(40, 950))

T("user_login_history_t", "auth", "one row per login attempt that reached a session", [
    C("login_history_id", ID, False, ai=True),
    C("user_id", ID, False),
    C("login_timestamp", "DATETIME", False, "CURRENT_TIMESTAMP"),
    C("ip_address", "VARCHAR(45)"),
    C("device_info", "VARCHAR(1000)"),
    C("remarks", "VARCHAR(255)"),
    *STD()], "login_history_id",
    indexes=[("idx_login_hist_user", ["user_id", "login_timestamp"])],
    fks=[("fk_login_hist_user", ["user_id"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    layout=(340, 950))

T("sessions", "auth", "express-mysql-session store (library owned column names)", [
    C("session_id", "VARCHAR(128)", False),
    C("expires", "INT UNSIGNED", False),
    C("data", "MEDIUMTEXT"),
    *STD()], "session_id",
    layout=(640, 950))

T("email_audit_logs_t", "auth", "every outgoing mail; otp rows carry verify_key and expiry", [
    C("email_audit_id", ID, False, ai=True),
    C("recipient_email", "VARCHAR(255)", False),
    C("email_subject", "VARCHAR(255)"),
    C("email_body", "TEXT"),
    C("email_status", "VARCHAR(20)", False, comment="SUCCESS | FAILED"),
    C("message_id", "VARCHAR(255)", comment="smtp message id"),
    C("response_data", "TEXT"),
    C("expires_at", "DATETIME"),
    C("verify_key", "VARCHAR(255)", comment="hashed otp"),
    C("is_used", "TINYINT(1)", comment="null until consumed"),
    C("used_by", "VARCHAR(255)"),
    C("used_for", "VARCHAR(50)", comment="forgot-password | reset-password"),
    C("create_user", "VARCHAR(255)"),
    *STD()], "email_audit_id",
    indexes=[("idx_email_audit_lookup", ["recipient_email", "used_for", "email_audit_id"])],
    layout=(940, 950))

T("audit_logs_t", "auth", "one row per audited business action", [
    C("audit_log_id", ID, False, ai=True),
    C("request_id", "CHAR(36)"),
    C("user_id", ID),
    C("action", "VARCHAR(50)", False),
    C("module", "VARCHAR(50)"),
    C("entity_type", "VARCHAR(50)"),
    C("entity_id", "VARCHAR(64)"),
    C("status", "VARCHAR(20)", comment="SUCCESS | FAILED"),
    C("status_key", "VARCHAR(50)"),
    C("description", "VARCHAR(1000)"),
    C("old_values", "JSON"),
    C("new_values", "JSON"),
    C("error_message", "TEXT"),
    C("ip_address", "VARCHAR(45)"),
    C("user_agent", "VARCHAR(500)"),
    *STD()], "audit_log_id",
    indexes=[("idx_audit_user_time", ["user_id", "created_at"]), ("idx_audit_request", ["request_id"])],
    fks=[("fk_audit_user", ["user_id"], "users_lst_t", ["user_id"], "SET NULL", False)],
    layout=(1240, 950))

T("user_devices_t", "auth", "phones that receive push notifications", [
    C("device_id", ID, False, ai=True),
    C("user_id", ID, False, comment="who is signed in on that phone"),
    C("push_token", "VARCHAR(512)", False, comment="the phone's firebase cloud messaging token"),
    C("platform", "VARCHAR(20)", False, "'android'", comment="android | ios"),
    C("last_registered_at", "DATETIME(3)", False, "CURRENT_TIMESTAMP(3)", comment="the app sends the token at every start and sign-in"),
    *STD(3)], "device_id",
    uniques=[("uq_device_push_token", ["push_token"])],
    indexes=[("idx_device_user", ["user_id", "is_active"])],
    fks=[("fk_device_user", ["user_id"], "users_lst_t", ["user_id"], "NO ACTION", False)],
    layout=(1540, 950))

T("app_releases_t", "auth", "published app versions; the app compares its build with the newest", [
    C("release_id", ID, False, ai=True),
    C("version", "VARCHAR(20)", False, comment="what users see, semver: 1.1.0"),
    C("version_code", "INT UNSIGNED", False, comment="what the app compares: major*10000 + minor*100 + patch"),
    C("apk_url", "VARCHAR(500)", False, comment="where the APK is downloaded from (github releases)"),
    C("notes", "TEXT", comment="what's new, shown in the update dialog"),
    C("is_mandatory", "TINYINT(1)", False, "0", comment="1 = older builds must update before using the app"),
    C("released_at", "DATETIME", False, "CURRENT_TIMESTAMP"),
    *STD()], "release_id",
    uniques=[("uq_release_version", ["version"]), ("uq_release_version_code", ["version_code"])],
    layout=(1540, 1150))

BY = {t["name"]: t for t in TABLES}
def col(t, name):
    for c in t["cols"]:
        if c["name"] == name: return c
    raise KeyError(f"{t['name']}.{name}")

# an fk needs an index on its columns; add one when no index/unique/pk already starts with them
def ensure_fk_indexes():
    for t in TABLES:
        for name, cols, *_ in t["fks"]:
            covered = [t["pk"]] == cols or any(ix[1][:len(cols)] == cols for ix in t["uniques"] + t["indexes"])
            if not covered:
                t["indexes"].append((name + "_idx", list(cols)))
ensure_fk_indexes()

# ----------------------------------------------------------------------------- DDL
def q(s): return "`" + s + "`"
def ddl_col(c):
    parts = [q(c["name"]), c["type"], "NOT NULL" if not c["null"] else "NULL"]
    if c["default"] is not None: parts.append("DEFAULT " + c["default"])
    if c["ai"]: parts.append("AUTO_INCREMENT")
    if c["comment"]: parts.append("COMMENT '" + c["comment"].replace("'", "''") + "'")
    return "  " + " ".join(parts)

def ddl_table(t):
    lines = [ddl_col(c) for c in t["cols"]]
    lines.append(f"  PRIMARY KEY ({q(t['pk'])})")
    for n, cols in t["uniques"]: lines.append(f"  UNIQUE KEY {q(n)} ({', '.join(map(q, cols))})")
    for n, cols in t["indexes"]: lines.append(f"  KEY {q(n)} ({', '.join(map(q, cols))})")
    for n, cols in t["fulltexts"]: lines.append(f"  FULLTEXT KEY {q(n)} ({', '.join(map(q, cols))})")
    for n, cols, rt, rc, od, deferred in t["fks"]:
        if deferred: continue
        lines.append(f"  CONSTRAINT {q(n)} FOREIGN KEY ({', '.join(map(q, cols))}) REFERENCES {q(rt)} ({', '.join(map(q, rc))}) ON DELETE {od} ON UPDATE NO ACTION")
    for n, expr in t["checks"]: lines.append(f"  CONSTRAINT {q(n)} CHECK ({expr})")
    body = ",\n".join(lines)
    return (f"CREATE TABLE IF NOT EXISTS {q(t['name'])} (\n{body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={COLLATION}"
            f" COMMENT='{t['comment'].replace(chr(39), chr(39)*2)}';\n")

# dependency order (ignore deferred fks)
def ordered():
    done, out = set(), []
    pending = list(TABLES)
    while pending:
        progressed = False
        for t in list(pending):
            deps = {fk[2] for fk in t["fks"] if not fk[5] and fk[2] != t["name"]}
            if deps <= done:
                out.append(t); done.add(t["name"]); pending.remove(t); progressed = True
        if not progressed: raise RuntimeError("cycle: " + ", ".join(t["name"] for t in pending))
    return out

def write_sql():
    o = [f"-- chat_application schema (v1 plus the v2, v3 and v4 additions). generated from the schema definition in gen_schema.py;",
         "-- for a NEW database. migration scripts for an existing database are kept only until every database has run them.",
         "-- every table carries is_active / created_at / updated_at with defaults.",
         "-- run as chatapp_admin:",
         "--   mysql -u chatapp_admin -p chat_application < documents/database/schema-v1.sql", "",
         "SET NAMES utf8mb4;", f"USE {q(SCHEMA)};", ""]
    for t in ordered():
        o.append(f"-- ---------------------------------------------------------------- {t['name']}")
        o.append(ddl_table(t))
    o.append("-- ---------------------------------------------------------------- circular foreign keys (messages <-> conversations)")
    for t in TABLES:
        for n, cols, rt, rc, od, deferred in t["fks"]:
            if deferred:
                o.append(f"SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = '{t['name']}' AND CONSTRAINT_NAME = '{n}');")
                o.append(f"SET @ddl := IF(@fk_exists = 0, 'ALTER TABLE {q(t['name'])} ADD CONSTRAINT {q(n)} FOREIGN KEY ({', '.join(map(q, cols))}) REFERENCES {q(rt)} ({', '.join(map(q, rc))}) ON DELETE {od} ON UPDATE NO ACTION', 'SELECT 1');")
                o.append("PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;")

    o.append("")
    o.append("-- ---------------------------------------------------------------- seed data (masters)")
    for t in TABLES:
        if not t["seeds"]: continue
        hdr, *rows = t["seeds"]
        vals = ",\n".join("  (" + ", ".join(repr(v) if isinstance(v, str) else str(v) for v in r) + ")" for r in rows)
        o.append(f"INSERT INTO {q(t['name'])} ({', '.join(map(q, hdr))}) VALUES\n{vals}\nON DUPLICATE KEY UPDATE {q(hdr[2])} = VALUES({q(hdr[2])});\n")
    open(OUT + "/schema-v1.sql", "w", encoding="utf-8", newline="\n").write("\n".join(o))

# ----------------------------------------------------------------------------- SVG
def write_svg():
    W, H = 2080, 1400; ROW, HEAD, PAD, BW = 16, 24, 8, 280
    FONT = "Consolas, 'Courier New', monospace"
    HEADFILL = {"core": "#1d4ed8", "chat": "#0f766e", "master": "#7c3aed", "auth": "#475569"}
    def rows_of(t):
        fkcols = {c for fk in t["fks"] for c in fk[1]}
        single_uq = {u[1][0] for u in t["uniques"] if len(u[1]) == 1}
        r = []
        for c in t["cols"]:
            flag = "PK" if c["name"] == t["pk"] else "FK" if c["name"] in fkcols else "UQ" if c["name"] in single_uq else ""
            ty = c["type"] + ("" if not c["null"] else " NULL") + (f" ={c['default']}" if c["default"] and len(c["default"]) <= 18 else "")
            r.append((flag, c["name"], ty))
        for n, cols in t["uniques"]:
            if len(cols) > 1: r.append(("UQ", "(" + ", ".join(cols) + ")", ""))
        for n, cols in t["indexes"]:
            if len(cols) > 1 and not n.endswith("_idx"): r.append(("IX", "(" + ", ".join(cols) + ")", ""))
        for n, expr in t["checks"]: r.append(("CK", expr, ""))
        return r
    R = {t["name"]: rows_of(t) for t in TABLES}
    def height(t): return HEAD + len(R[t["name"]]) * ROW + PAD
    def row_y(t, c):
        for i, (f, n, ty) in enumerate(R[t["name"]]):
            if n == c: return t["layout"][1] + HEAD + i * ROW + ROW / 2 + 2
        return t["layout"][1] + HEAD / 2
    esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">',
           '<defs><marker id="one" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M5 1 V11 M8 1 V11" stroke="#334155" stroke-width="1.6" fill="none"/></marker>'
           '<marker id="many" markerWidth="14" markerHeight="14" refX="1" refY="7" orient="auto"><path d="M1 7 L13 1 M1 7 L13 13 M1 7 L13 7 M10 1 V13" stroke="#334155" stroke-width="1.6" fill="none"/></marker></defs>',
           f'<rect width="{W}" height="{H}" fill="#f8fafc"/>',
           '<rect x="20" y="20" width="2040" height="890" rx="10" fill="#ecfeff" stroke="#a5f3fc"/>',
           '<text x="36" y="46" font-size="15" font-weight="bold" fill="#155e75">CHAT  -  ONE_TO_ONE / GROUP conversations, one receipt per recipient, blocks, edits, scheduled messages, seeded masters</text>',
           '<rect x="20" y="925" width="2040" height="445" rx="10" fill="#f1f5f9" stroke="#cbd5e1"/>',
           '<text x="36" y="945" font-size="15" font-weight="bold" fill="#334155">AUTH &amp; PLATFORM  -  tables the existing login / session / otp / audit / upload code reads</text>',
           f'<text x="36" y="{H-10}" font-size="12" fill="#64748b">Every table: is_active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP. Ids BIGINT UNSIGNED. InnoDB, utf8mb4.</text>']
    for t in TABLES:
        for n, cols, rt, rc, od, deferred in t["fks"]:
            a, b = t, BY[rt]; ax0, ay0 = a["layout"]; bx0, by0 = b["layout"]
            ay = row_y(a, cols[0]); by = by0 + HEAD / 2
            if ax0 + BW < bx0: ax, bx = ax0 + BW, bx0
            elif bx0 + BW < ax0: ax, bx = ax0, bx0 + BW
            else: ax = bx = (ax0 + BW) if ax0 >= 900 else ax0
            if ax == bx:
                off = 26 if ax > ax0 else -26
                d = f"M{ax} {ay} H{ax+off} V{by} H{bx}"
            elif ay0 >= 900 and by0 < 900 and ax > bx + 300:
                d = f"M{ax} {ay} H{ax-16} V887 H{bx+22} V{by} H{bx}"
            else:
                mid = (ax + bx) / 2
                d = f"M{ax} {ay} H{mid} V{by} H{bx}"
            out.append(f'<path d="{d}" fill="none" stroke="#334155" stroke-width="1.4" stroke-dasharray="5 3" marker-start="url(#many)" marker-end="url(#one)"/>')
    for t in TABLES:
        x, y = t["layout"]; h = height(t)
        out.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{h}" rx="6" fill="#ffffff" stroke="#94a3b8" stroke-width="1.2"/>')
        out.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{HEAD}" rx="6" fill="{HEADFILL[t["group"]]}"/>')
        out.append(f'<rect x="{x}" y="{y+HEAD-6}" width="{BW}" height="6" fill="{HEADFILL[t["group"]]}"/>')
        out.append(f'<text x="{x+10}" y="{y+17}" font-size="13" font-weight="bold" fill="#fff">{esc(t["name"])}</text>')
        for i, (f, c, ty) in enumerate(R[t["name"]]):
            cy = y + HEAD + (i + 1) * ROW - 3
            colour = {"PK": "#b45309", "FK": "#be123c", "UQ": "#0369a1", "CK": "#0369a1", "IX": "#0369a1"}.get(f, "#94a3b8")
            out.append(f'<text x="{x+6}" y="{cy}" font-size="10" font-weight="bold" fill="{colour}">{f or "·"}</text>')
            out.append(f'<text x="{x+26}" y="{cy}" font-size="10.5" fill="#0f172a">{esc(c)}</text>')
            if ty: out.append(f'<text x="{x+BW-6}" y="{cy}" font-size="9" fill="#64748b" text-anchor="end">{esc(ty)}</text>')
    out.append("</svg>")
    open(OUT + "/chat-app-erd-v2.svg", "w", encoding="utf-8", newline="\n").write("\n".join(out))

# ----------------------------------------------------------------------------- Workbench model
_ptr = [0x1000]
def ptr():
    _ptr[0] += 0x10
    return f"{_ptr[0]:016X}"
def gid(): return "{" + str(uuid.uuid4()).upper() + "}"

TYPE_RE = re.compile(r"^(\w+)(?:\((\d+)\))?( UNSIGNED)?$")
def wb_type(typ):
    m = TYPE_RE.match(typ); base, n, uns = m.group(1).lower(), m.group(2), m.group(3)
    n = int(n) if n else -1
    length = precision = -1; flags = ["UNSIGNED"] if uns else []
    simple = base
    if base in ("varchar", "char"): length = n
    elif base == "datetime": simple = "datetime_f"; precision = n
    elif base in ("tinyint", "int", "bigint"): precision = n
    return simple, length, precision, flags

def xml_column(c, table_id, col_id):
    simple, length, precision, flags = wb_type(c["type"])
    flagxml = ("\n" + "".join(f'                        <value type="string">{f}</value>\n' for f in flags) + "                      ") if flags else ""
    flagnode = f'<value _ptr_="{ptr()}" type="list" content-type="string" key="flags">{flagxml}</value>' if flags else f'<value _ptr_="{ptr()}" type="list" content-type="string" key="flags"/>'
    return f'''                    <value type="object" struct-name="db.mysql.Column" id="{col_id}" struct-checksum="0xba88e21c">
                      <value type="int" key="autoIncrement">{1 if c["ai"] else 0}</value>
                      <value type="string" key="expression"></value>
                      <value type="int" key="generated">0</value>
                      <value type="string" key="generatedStorage"></value>
                      <value type="string" key="characterSetName"></value>
                      <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.CheckConstraint" key="checks"/>
                      <value type="string" key="collationName"></value>
                      <value type="string" key="datatypeExplicitParams"></value>
                      <value type="string" key="defaultValue">{xesc(c["default"] or "")}</value>
                      <value type="int" key="defaultValueIsNull">0</value>
                      {flagnode}
                      <value type="int" key="isNotNull">{0 if c["null"] else 1}</value>
                      <value type="int" key="length">{length}</value>
                      <value type="int" key="precision">{precision}</value>
                      <value type="int" key="scale">-1</value>
                      <link type="object" struct-name="db.SimpleDatatype" key="simpleType">com.mysql.rdbms.mysql.datatype.{simple}</link>
                      <value type="string" key="comment">{xesc(c["comment"])}</value>
                      <value type="string" key="name">{c["name"]}</value>
                      <value type="string" key="oldName"></value>
                      <link type="object" struct-name="GrtObject" key="owner">{table_id}</link>
                    </value>
'''

def xml_index(name, kind, cols, table_id, colids, idx_id):
    cx = "".join(f'''                        <value type="object" struct-name="db.mysql.IndexColumn" id="{gid()}" struct-checksum="0x62630b3c">
                          <value type="int" key="columnLength">0</value>
                          <value type="string" key="comment"></value>
                          <value type="int" key="descend">0</value>
                          <value type="string" key="expression"></value>
                          <link type="object" struct-name="db.Column" key="referencedColumn">{colids[c]}</link>
                          <value type="string" key="name"></value>
                          <link type="object" struct-name="GrtObject" key="owner">{idx_id}</link>
                        </value>
''' for c in cols)
    return f'''                    <value type="object" struct-name="db.mysql.Index" id="{idx_id}" struct-checksum="0xdb1989cd">
                      <value type="string" key="algorithm"></value>
                      <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.IndexColumn" key="columns">
{cx}                      </value>
                      <value type="string" key="indexKind"></value>
                      <value type="int" key="keyBlockSize">0</value>
                      <value type="string" key="lockOption"></value>
                      <value type="int" key="visible">1</value>
                      <value type="string" key="withParser"></value>
                      <value type="string" key="comment"></value>
                      <value type="int" key="deferability">0</value>
                      <value type="string" key="indexType">{kind}</value>
                      <value type="int" key="isPrimary">{1 if kind == "PRIMARY" else 0}</value>
                      <value type="string" key="name">{name}</value>
                      <value type="int" key="unique">{1 if kind == "UNIQUE" else 0}</value>
                      <value type="int" key="commentedOut">0</value>
                      <value type="string" key="createDate"></value>
                      <value _ptr_="{ptr()}" type="dict" key="customData"/>
                      <value type="string" key="lastChangeDate"></value>
                      <value type="int" key="modelOnly">0</value>
                      <link type="object" struct-name="GrtNamedObject" key="owner">{table_id}</link>
                      <value type="string" key="temp_sql"></value>
                      <value type="string" key="oldName">{name if kind == "PRIMARY" else ""}</value>
                    </value>
'''

def xml_fk(fk, t, ids, fk_id, index_id):
    name, cols, rt, rc, od, _ = fk
    mandatory = 0 if col(t, cols[0])["null"] else 1
    return f'''                    <value type="object" struct-name="db.mysql.ForeignKey" id="{fk_id}" struct-checksum="0x70a8fc40">
                      <link type="object" struct-name="db.mysql.Table" key="referencedTable">{ids[rt]["table"]}</link>
                      <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.Column" key="columns">
{"".join(f"                        <link type=\"object\">{ids[t['name']]['cols'][c]}</link>" + chr(10) for c in cols)}                      </value>
                      <value _ptr_="{ptr()}" type="dict" key="customData"/>
                      <value type="int" key="deferability">0</value>
                      <value type="string" key="deleteRule">{od}</value>
                      <link type="object" struct-name="db.Index" key="index">{index_id}</link>
                      <value type="int" key="mandatory">{mandatory}</value>
                      <value type="int" key="many">1</value>
                      <value type="int" key="modelOnly">0</value>
                      <link type="object" struct-name="db.Table" key="owner">{ids[t['name']]['table']}</link>
                      <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.Column" key="referencedColumns">
{"".join(f"                        <link type=\"object\">{ids[rt]['cols'][c]}</link>" + chr(10) for c in rc)}                      </value>
                      <value type="int" key="referencedMandatory">1</value>
                      <value type="string" key="updateRule">NO ACTION</value>
                      <value type="string" key="comment"></value>
                      <value type="string" key="name">{name}</value>
                      <value type="string" key="oldName"></value>
                    </value>
'''

def xml_table(t, ids, schema_id, fk_ids):
    tid = ids[t["name"]]["table"]; colids = ids[t["name"]]["cols"]
    cols = "".join(xml_column(c, tid, colids[c["name"]]) for c in t["cols"])
    # indexes: primary, uniques, plain. remember index ids so fks can point at the covering one
    idx_ids = {}
    pk_id = gid(); idx_ids[("PK",)] = pk_id
    ix = xml_index("PRIMARY", "PRIMARY", [t["pk"]], tid, colids, pk_id)
    for n, c in t["uniques"]:
        i = gid(); idx_ids[tuple(c)] = idx_ids.get(tuple(c), i); ix += xml_index(n, "UNIQUE", c, tid, colids, i)
    for n, c in t["indexes"]:
        i = gid(); idx_ids.setdefault(tuple(c), i); ix += xml_index(n, "INDEX", c, tid, colids, i)
    for n, c in t["fulltexts"]:
        ix += xml_index(n, "FULLTEXT", c, tid, colids, gid())
    def covering(cols):
        if cols == [t["pk"]]: return pk_id
        for k, v in idx_ids.items():
            if list(k[:len(cols)]) == cols: return v
        raise RuntimeError("no index for fk " + str(cols))
    fks = "".join(xml_fk(fk, t, ids, fk_ids[(t["name"], fk[0])], covering(fk[1])) for fk in t["fks"])
    fknode = (f'<value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.ForeignKey" key="foreignKeys">\n{fks}                  </value>'
              if fks else f'<value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.ForeignKey" key="foreignKeys"/>')
    return f'''                <value type="object" struct-name="db.mysql.Table" id="{tid}" struct-checksum="0x4564421a">
                  <value type="string" key="avgRowLength"></value>
                  <value type="int" key="checksum">0</value>
                  <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.Column" key="columns">
{cols}                  </value>
                  <value type="string" key="connectionString"></value>
                  <value type="string" key="defaultCharacterSetName">utf8mb4</value>
                  <value type="string" key="defaultCollationName">{COLLATION}</value>
                  <value type="int" key="delayKeyWrite">0</value>
                  {fknode}
                  <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.Index" key="indices">
{ix}                  </value>
                  <value type="string" key="keyBlockSize"></value>
                  <value type="string" key="maxRows"></value>
                  <value type="string" key="mergeInsert"></value>
                  <value type="string" key="mergeUnion"></value>
                  <value type="string" key="minRows"></value>
                  <value type="string" key="nextAutoInc"></value>
                  <value type="string" key="packKeys"></value>
                  <value type="int" key="partitionCount">0</value>
                  <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.PartitionDefinition" key="partitionDefinitions"/>
                  <value type="string" key="partitionExpression"></value>
                  <value type="int" key="partitionKeyAlgorithm">0</value>
                  <value type="string" key="partitionType"></value>
                  <value type="string" key="password"></value>
                  <link type="object" struct-name="db.mysql.Index" key="primaryKey">{pk_id}</link>
                  <value type="string" key="raidChunkSize"></value>
                  <value type="string" key="raidChunks"></value>
                  <value type="string" key="raidType"></value>
                  <value type="string" key="rowFormat"></value>
                  <value type="string" key="statsAutoRecalc"></value>
                  <value type="string" key="statsPersistent"></value>
                  <value type="int" key="statsSamplePages">0</value>
                  <value type="int" key="subpartitionCount">0</value>
                  <value type="string" key="subpartitionExpression"></value>
                  <value type="int" key="subpartitionKeyAlgorithm">0</value>
                  <value type="string" key="subpartitionType"></value>
                  <value type="string" key="tableDataDir"></value>
                  <value type="string" key="tableEngine">InnoDB</value>
                  <value type="string" key="tableIndexDir"></value>
                  <value type="string" key="tableSpace"></value>
                  <value _ptr_="{ptr()}" type="list" content-type="object" content-struct-name="db.mysql.Trigger" key="triggers"/>
                  <value type="int" key="isStub">0</value>
                  <value type="int" key="isSystem">0</value>
                  <value type="int" key="isTemporary">0</value>
                  <value type="string" key="temporaryScope"></value>
                  <value type="int" key="commentedOut">0</value>
                  <value type="string" key="createDate">2026-10-25 12:00</value>
                  <value _ptr_="{ptr()}" type="dict" key="customData"/>
                  <value type="string" key="lastChangeDate">2026-10-25 12:00</value>
                  <value type="int" key="modelOnly">0</value>
                  <value type="string" key="name">{t["name"]}</value>
                  <link type="object" struct-name="GrtNamedObject" key="owner">{schema_id}</link>
                  <value type="string" key="temp_sql"></value>
                  <value type="string" key="comment">{xesc(t["comment"])}</value>
                  <value type="string" key="oldName"></value>
                </value>
'''

FIG_COLOR = {"core": "#98BFDA", "chat": "#9FD9BF", "master": "#D0B0E0", "auth": "#C8C8C8"}
def xml_figure(t, fig_id, table_id, layer_id, diagram_id):
    x, y = t["layout"]; h = 36 + 20 * len(t["cols"]) + 40
    return f'''              <value type="object" struct-name="workbench.physical.TableFigure" id="{fig_id}" struct-checksum="0x3b14eccb">
                <value type="int" key="columnsExpanded">1</value>
                <value type="int" key="foreignKeysExpanded">0</value>
                <value type="int" key="indicesExpanded">0</value>
                <value type="int" key="summarizeDisplay">-1</value>
                <link type="object" struct-name="db.Table" key="table">{table_id}</link>
                <value type="int" key="triggersExpanded">0</value>
                <value type="string" key="color">{FIG_COLOR[t["group"]]}</value>
                <value type="int" key="expanded">1</value>
                <value type="real" key="height">{h}</value>
                <link type="object" struct-name="model.Layer" key="layer">{layer_id}</link>
                <value type="real" key="left">{x}</value>
                <value type="int" key="locked">0</value>
                <value type="int" key="manualSizing">1</value>
                <value type="real" key="top">{y + 20}</value>
                <value type="real" key="width">270</value>
                <link type="object" struct-name="model.Diagram" key="owner">{diagram_id}</link>
                <value type="int" key="visible">1</value>
                <value type="string" key="name">{t["name"]}</value>
              </value>
'''

def xml_connection(fk_name, fk_id, start_fig, end_fig, diagram_id):
    return f'''              <value type="object" struct-name="workbench.physical.Connection" id="{gid()}" struct-checksum="0x9baebc92">
                <value type="string" key="caption">{fk_name}</value>
                <value type="real" key="captionXOffs">0</value>
                <value type="real" key="captionYOffs">0</value>
                <value type="string" key="comment"></value>
                <value type="real" key="endCaptionXOffs">0</value>
                <value type="real" key="endCaptionYOffs">0</value>
                <value type="string" key="extraCaption"></value>
                <value type="real" key="extraCaptionXOffs">0</value>
                <value type="real" key="extraCaptionYOffs">0</value>
                <link type="object" struct-name="db.ForeignKey" key="foreignKey">{fk_id}</link>
                <value type="real" key="middleSegmentOffset">0</value>
                <value type="real" key="startCaptionXOffs">0</value>
                <value type="real" key="startCaptionYOffs">0</value>
                <value type="int" key="drawSplit">0</value>
                <link type="object" struct-name="model.Figure" key="endFigure">{end_fig}</link>
                <link type="object" struct-name="model.Figure" key="startFigure">{start_fig}</link>
                <link type="object" struct-name="model.Diagram" key="owner">{diagram_id}</link>
                <value type="int" key="visible">1</value>
                <value type="string" key="name"></value>
              </value>
'''

def replace_list(s, open_tag_regex, close_indent, inner):
    """replace the body of the first list whose opening tag matches; close tag is '</value>' at close_indent spaces"""
    m = re.search(open_tag_regex, s); assert m, open_tag_regex
    tag = m.group(0)
    if tag.endswith("/>"):
        new_tag = tag[:-2] + ">"
        return s[:m.start()] + new_tag + "\n" + inner + " " * close_indent + "</value>" + s[m.end():]
    end = re.compile(r"\n {%d}</value>" % close_indent).search(s, m.end()); assert end
    return s[:m.end()] + "\n" + inner.rstrip("\n") + s[end.start():]

def write_mwb():
    s = open(MWB_SRC + "/document.mwb.xml", encoding="utf-8").read()
    schema_id = re.search(r'struct-name="db.mysql.Schema" id="(\{[^}]+\})"', s).group(1)
    diagram_id = re.search(r'struct-name="workbench.physical.Diagram" id="(\{[^}]+\})"', s).group(1)
    root_layer_id = re.search(r'struct-name="workbench.physical.Layer" id="(\{[^}]+\})" struct-checksum="0x1d14ca4b" key="rootLayer"', s).group(1)
    masters_layer_id = re.search(r'struct-name="workbench.physical.Layer" id="(\{[^}]+\})" struct-checksum="0x1d14ca4b">', s).group(1)

    ids = {t["name"]: dict(table=gid(), cols={c["name"]: gid() for c in t["cols"]}, fig=gid()) for t in TABLES}
    fk_ids = {(t["name"], fk[0]): gid() for t in TABLES for fk in t["fks"]}

    tables_xml = "".join(xml_table(t, ids, schema_id, fk_ids) for t in TABLES)
    s = replace_list(s, r'<value _ptr_="[0-9A-F]+" type="list" content-type="object" content-struct-name="db.mysql.Table" key="tables">', 14, tables_xml)

    figures_xml = "".join(xml_figure(t, ids[t["name"]]["fig"], ids[t["name"]]["table"],
                                     masters_layer_id if t["group"] == "master" else root_layer_id, diagram_id) for t in TABLES)
    # the diagram's own figures list is the one holding TableFigure objects (indent 12)
    s = replace_list(s, r'<value _ptr_="[0-9A-F]+" type="list" content-type="object" content-struct-name="model.Figure" key="figures">\n {14}<value type="object" struct-name="workbench.physical.TableFigure"', 12, figures_xml) \
        if False else s
    m = re.search(r'<value _ptr_="[0-9A-F]+" type="list" content-type="object" content-struct-name="model.Figure" key="figures">\n(?= {14}<value type="object" struct-name="workbench.physical.TableFigure")', s)
    end = re.compile(r"\n {12}</value>").search(s, m.end())
    s = s[:m.end()] + figures_xml.rstrip("\n") + s[end.start():]

    conns_xml = "".join(xml_connection(fk[0], fk_ids[(t["name"], fk[0])], ids[t["name"]]["fig"], ids[fk[2]]["fig"], diagram_id)
                        for t in TABLES for fk in t["fks"])
    m = re.search(r'<value _ptr_="[0-9A-F]+" type="list" content-type="object" content-struct-name="model.Connection" key="connections">\n', s)
    end = re.compile(r"\n {12}</value>").search(s, m.end())
    s = s[:m.end()] + conns_xml.rstrip("\n") + s[end.start():]

    # layer figure links: masters layer gets the two masters, root layer the rest
    def links(names, indent): return "".join(" " * indent + f'<link type="object">{ids[n]["fig"]}</link>\n' for n in names)
    masters = [t["name"] for t in TABLES if t["group"] == "master"]; others = [t["name"] for t in TABLES if t["group"] != "master"]
    m = re.search(r'(struct-name="workbench.physical.Layer" id="' + re.escape(masters_layer_id) + r'".*?key="figures">\n)(.*?)(\n {16}</value>)', s, re.S)
    s = s[:m.start(2)] + links(masters, 18).rstrip("\n") + s[m.end(2):]
    m = re.search(r'(key="rootLayer">.*?key="figures">\n)(.*?)(\n {14}</value>)', s, re.S)
    s = s[:m.start(2)] + links(others, 16).rstrip("\n") + s[m.end(2):]
    # masters layer geometry around the two master figures
    s = re.sub(r'(struct-name="workbench.physical.Layer" id="' + re.escape(masters_layer_id) + r'".*?key="height">)[^<]+', r'\g<1>640', s, count=1, flags=re.S)
    s = re.sub(r'(struct-name="workbench.physical.Layer" id="' + re.escape(masters_layer_id) + r'".*?key="left">)[^<]+', r'\g<1>1460', s, count=1, flags=re.S)
    s = re.sub(r'(struct-name="workbench.physical.Layer" id="' + re.escape(masters_layer_id) + r'".*?key="top">)[^<]+', r'\g<1>60', s, count=1, flags=re.S)
    s = re.sub(r'(struct-name="workbench.physical.Layer" id="' + re.escape(masters_layer_id) + r'".*?key="width">)[^<]+', r'\g<1>310', s, count=1, flags=re.S)
    # selection: clear
    s = re.sub(r'(content-struct-name="model.Object" key="selection">)\n.*?\n {12}</value>', r'\1\n            </value>', s, count=1, flags=re.S)
    # canvas size
    s = s.replace('<value type="real" key="height">1380.95</value>', '<value type="real" key="height">1500</value>')
    s = s.replace('<value type="real" key="width">1972</value>', '<value type="real" key="width">1900</value>')
    # schema name + charset
    s = s.replace('<value type="string" key="name">mydb</value>', f'<value type="string" key="name">{SCHEMA}</value>')
    s = s.replace('<value type="string" key="defaultCharacterSetName">utf8</value>\n              <value type="string" key="defaultCollationName">utf8_general_ci</value>',
                  f'<value type="string" key="defaultCharacterSetName">utf8mb4</value>\n              <value type="string" key="defaultCollationName">{COLLATION}</value>')
    assert SCHEMA in s

    # --- integrity check: every {GUID} link must resolve to an id in the document
    import xml.etree.ElementTree as ET
    root = ET.fromstring(s)
    all_ids = {el.get("id") for el in root.iter("value") if el.get("id")}
    bad = [l.text for l in root.iter("link") if l.text and l.text.startswith("{") and l.text not in all_ids]
    assert not bad, f"dangling links: {bad[:5]}"
    names = [t.get for t in []]
    found = [el.text for el in root.iter("value") if el.get("key") == "name" and el.text in BY]
    assert len(found) >= len(TABLES), found

    # --- package
    build = SCRATCH + "/mwb_build"; shutil.rmtree(build, ignore_errors=True); os.makedirs(build + "/@db")
    open(build + "/document.mwb.xml", "w", encoding="utf-8", newline="\n").write(s)
    shutil.copy(MWB_SRC + "/lock", build + "/lock")
    shutil.copy(MWB_SRC + "/@db/data.db", build + "/@db/data.db")
    db = sqlite3.connect(build + "/@db/data.db")
    for (n,) in db.execute("select name from sqlite_master where type='table' and name like '{%'").fetchall():
        db.execute(f'DROP TABLE "{n}"')
    for t in TABLES:
        db.execute(f'CREATE TABLE "{ids[t["name"]]["table"]}" (' + ", ".join(f'"{c["name"]}"' for c in t["cols"]) + ")")
    db.commit(); db.close()
    out = OUT + "/chat_application_model_v2.mwb"
    with zipfile.ZipFile(out, "w") as z:
        z.write(build + "/document.mwb.xml", "document.mwb.xml", zipfile.ZIP_DEFLATED)
        z.write(build + "/lock", "lock", zipfile.ZIP_STORED)
        z.write(build + "/@db/data.db", "@db/data.db", zipfile.ZIP_DEFLATED)
    return out

if __name__ == "__main__":
    write_sql(); print("sql ok")
    write_svg(); print("svg ok")
    print("mwb ok:", write_mwb())
