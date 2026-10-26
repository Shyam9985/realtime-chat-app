# Chat App

Real-time one-to-one chat application. The product requirements are in the SRS v1.1 and the ERD
in `documents/`. Stack: Node.js, Express, MySQL, Redis and Socket.IO on the server; a React Native
(Expo) app as the client.

Section 2 describes the server foundation (authentication, sessions, rate limiting, auditing,
logging, validation, upload). Section 5 is the chat implementation, section 6 the React Native app.

## 1. Layout

The repo root is the backend project: run `npm install && npm start` here.

```
chat-app/
  README.md            this file
  server.js            process entry: loads .env, connects redis, listens, graceful shutdown
  node.js              express app: security headers, cors, body parsing, session, routes, error handler
  package.json         server dependencies and the start script
  .env.example         every variable the server reads, values blank
  certs/               put the database CA here as ca.pem
  metrics/             one request-log file per day is written here (gitignored)
  tests/               integration suite (npm test) and tests/tools/peer.js
  mobile/              react native (expo) app, the client, see section 6
  server/              server application code (routes, controllers, services, models, ...), see section 2
  documents/           chat-app-erd-v1.png (add the SRS pdf here)
```

## 2. Server

Request path through `node.js`, in order: request id and metrics logger, helmet (CSP, frame
denial), cors allowlist, json and urlencoded body parsing (50 MB limit, tighten for chat),
cookie parser, static files from `server/public`, morgan console log, express-session backed by
MySQL, then `/apiv1/*` routes, a 404 handler and a global error handler that never leaks the
real error message to the client.

### 2.1 Folders under `server/`

| Folder | Purpose |
|---|---|
| `config/` | `db.config.js`: two mysql2 pools, `pool` (admin, the default) and `userPool` (read/write only), 7 connections each, TLS on |
| `redis/` | `redis.client.js` connect/destroy/ready flag; `redis.ratelimit.js` token-bucket limiter in Redis; `redis.utils.js` get/set/del helpers for caching |
| `middleware/` | the five cross-cutting middlewares, see 2.2 |
| `utils/` | shared helpers, see 2.3 |
| `routes/` | express routers; `apiRoutes.js` mounts them under `/apiv1` |
| `controllers/` | validate the payload, call a service, map errors to a standard response |
| `services/` | business rules; throw named errors via `resutils.createError(name, message)` |
| `models/` | SQL only, through `db.utils.executeQuery` with bound parameters |
| `uploads/` | files saved by the upload endpoint (`profile-photos/` for avatars), gitignored |
| `public/` | anything served statically |

### 2.2 Middleware

| File | Export | What it does |
|---|---|---|
| `authMdlwre.js` | `isAuthenticated` | reads the `access-token: Bearer <jwt>` header, verifies HS256. On an expired JWT it checks the stored session; if alive and not locked it issues a fresh JWT in the `new-access-token` response header and slides the session. Sets `req.user` |
| `rateLimitmdlwre.js` | `checkRateLimit(refillRate, capacity)` | token bucket per user (or IP when anonymous) + method + route. Redis first, in-memory fallback. `checkRateLimit(5 / 900, 5)` = 5 requests, refilling 5 per 15 minutes |
| `auditMdlwre.js` | `audit(entity, action, table?, pk?)` | marks a route as auditable; the row is written to `audit_logs_t` when the response goes out. With table and pk it snapshots the old row for update/delete routes |
| `requestLoggerMdlwre.js` | `requestId`, `requestLogger`, `closeMetrics` | uuid per request (`x-request-id` header) and one JSON line per request in `metrics/YYYY-MM-DD.log`, body redacted |
| `loggerMdlwre.js` | default | morgan console line per request, coloured with chalk |

### 2.3 Utils

| File | Exports | Notes |
|---|---|---|
| `db.utils.js` | `executeQuery`, `executeTransaction`, `executeTransactionQueries`, `executeMultipleQueries`, `getConnection`, `validateQueryAndValues` | every DB call goes through here; errors become `DatabaseError` with a `code` |
| `db-errors.js` | `getDatabaseError` | maps MySQL error codes to friendly messages |
| `response.utils.js` | `sendSuccessResponse`, `sendErrorResponse`, `sendProgressResponse`, `createError` | one JSON shape for every response: `{ success, code, statusKey, message, data | error }` |
| `standard.messages.js` | `RESPONSE_STATUS` | 42 named statuses (`SUCCESS`, `CREATED`, `VALIDATION_ERROR`, `TOKEN_EXPIRED`, `INVALID_OTP`, ...) each with `code`, `statusKey`, `message` |
| `validate.utils.js` | `validatePayload(body, schema)`, `parseId`, `toIso`, plus `isValidEmail`, `isValidMobile`, `isStrongPassword`, `isValidString`, `isValidNumber`, `isValidArray`, `isValidObject`, ... | schema types: `string`, `number`, `boolean`, `email`, `password`, `mobile-no`, `alpha`, `alpha-numeric`, `array`, `object`; supports nested schemas and strict mode |
| `redact.utils.js` | `redact`, `limitSize`, `SENSITIVE_KEYS` | strips passwords, tokens and hashes before anything is logged |
| `request.utils.js` | `getClientIp`, `getUserAgent`, `getRequestContext` | ip and parsed device info for login history |
| `cache.utils.js` | `applyCacheHeaders`, `CACHE_TYPES` | Cache-Control headers; responses default to no-store |
| `log.utils.js` | `log`, `logBlock` | console logging gated by `SHOW_LOG` |
| `date.utils.js` | `formatLocal`, `parseLocal`, `todayLocal`, `addDaysLocal`, `daysBetweenLocal`, `displayDate`, `displayDateTime`, ... | date-fns wrappers with one day format everywhere |
| `email.utils.js` | `sendEmail`, `get6DigitOtp` | nodemailer over Gmail SMTP; every send is logged to `email_audit_logs_t` |
| `files.utils.js` | `ALLOWED_IMAGE_TYPES`, `MAX_FILE_SIZE_BYTES`, `sanitizeFileName`, `generateUniqueFileName`, `matchesMagicBytes`, `sha256` | jpeg, png, webp only, 10 MB max, real type checked by magic bytes |
| `events.utils.js` | `appEvents` | a shared EventEmitter for in-process events |
| `schedule.utils.js` | (side effect) | node-schedule jobs, enabled by `SCHEDULE_RUN=true`; currently one hourly job that unlocks locked accounts |

### 2.4 Endpoints that exist

All under `/apiv1`. Rate limits are per user or IP.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /auth/signup` | no | create account: email, password, first name required, last name and mobile optional |
| `POST /auth/login` | no | email + password; returns the user object and the JWT in the `access-token` header; sets the session cookie |
| `POST /auth/logout` | cookie | destroys the express session and expires the stored session row |
| `POST /auth/forgot-password` | no | emails a 6-digit OTP, valid 5 minutes |
| `POST /auth/email/verify-otp` | no | checks `email`, `otp`, `message_key` |
| `POST /auth/update-password` | no | new password after a verified OTP (`otpKey`) |
| `GET /auth/reset-password/send-email` | yes | OTP mail for a logged-in password change |
| `GET /profile` | yes | fresh user object for the logged-in user plus `profile_photo` |
| `POST /files/upload` | yes | raw request body is the file; name in `x-file-name`, type in `content-type`; streams to disk, records the row, repoints the user's photo |
| `GET /files/profile-photo` | yes | streams the current photo |

### 2.5 Login and token flow

1. Login validates the payload, loads the user by email, checks the lock flag, compares the
   bcrypt hash. A wrong password increments `login_attempts`; the 5th locks the account for a
   day and the hourly job unlocks it.
2. The express session is regenerated, saved to MySQL, and a row goes to `user_sessions_t`
   and `user_login_history_t`.
3. A JWT (HS256, `SESSION_EXPIRES`) carrying the user object and `session_id` is returned in the
   `access-token` header.
4. Every protected request sends `access-token: Bearer <jwt>`. When the JWT expires but the
   session row is still alive, the middleware issues a new JWT in `new-access-token`; the client
   interceptor swaps it in. When the session is gone the client gets `SESSION_EXPIRED` and logs out.

### 2.6 Database schema

The schema lives in `documents/database/`: `schema-v1.sql` (the DDL plus master seeds, idempotent),
`chat_application_model_v2.mwb` (the Workbench model) and `chat-app-erd-v2.png` (the diagram). All
three are generated from one definition in `documents/database/tools/gen_schema.py`, so change the
schema there, run the script, and screenshot the svg for the png rather than editing a table by hand. Every table has `is_active`, `created_at` and `updated_at` with defaults;
ids are `BIGINT UNSIGNED`; engine InnoDB, charset `utf8mb4_0900_ai_ci`.

| Table | Purpose |
|---|---|
| `users_lst_t` | accounts; `user_nm` holds the login id (the email), plus lock columns and `profile_photo_url` |
| `user_sessions_t` | app sessions issued at login (`session_id`, `expires_at`, `destroyed_at`) |
| `user_login_history_t` | ip and device per login |
| `sessions` | express-mysql-session store; library owned column names |
| `email_audit_logs_t` | every outgoing mail; OTP rows carry `verify_key`, `expires_at`, `is_used`, `used_for` |
| `audit_logs_t` | one row per audited business action, `old_values` / `new_values` as JSON |
| `uploaded_files_lst_t` | files saved by the upload endpoint |
| `conversations_type_master_t` | seeded: `ONE_TO_ONE`, `GROUP` |
| `message_type_master_t` | seeded: `TEXT`, `EMOJI`, `IMAGE`, `VIDEO`, `AUDIO`, `FILE`, `SYSTEM` |
| `conversations_lst_t` | one row per chat; `user_pair_key` (`lowId:highId`) is unique so a pair has one direct chat; `last_message_id` / `last_message_at` denormalised for the list |
| `conversation_members_t` | membership with `member_role`, `last_read_message_id` for unread counts, unique per (conversation, user) |
| `messages_lst_t` | `content`, `message_type_id`, optional `attachment_file_id`, `client_message_id` unique per sender for idempotent sends, `is_deleted` / `deleted_at`; indexed on (`conversation_id`, `created_at`, `message_id`) for keyset paging |
| `message_receipts_t` | `delivered_at` / `seen_at` per recipient per message |
| `user_blocks_t` | blocker to blocked, unique per pair; unblock sets `is_active = 0` |

Apply or re-apply with:

```
mysql -u chatapp_admin -p chat_application < documents/database/schema-v1.sql
```

### 2.7 Environment variables (`.env.example`)

| Variable | Used for |
|---|---|
| `NODE_ENV` | `production` turns on secure cookies and `trust proxy` |
| `PORT` | listen port |
| `JWT_SECRET`, `SESSION_EXPIRES` | JWT signing key and lifetime (e.g. `15m`) |
| `EXPRESS_SECRET`, `EXPRESS_SESSION_EXPIRES` | session cookie signing key and lifetime in ms |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | MySQL |
| `ADMIN_USER/PASSWORD`, `CHAT_USER/PASSWORD` | the two pool logins, created by `documents/database/create-app-users.sql` |
| `REDIS_URL`, `REDIS_USERNAME`, `REDIS_PASSWORD` | Redis; username and password blank for a local instance |
| `EMAIL_USER`, `EMAIL_PASSWORD` | Gmail SMTP login for OTP mails |
| `APP_NAME` | name shown in outgoing mails |
| `CLIENT_ORIGINS` | comma-separated browser origins allowed by CORS (the Expo web build); native apps send no origin |
| `SCHEDULE_RUN`, `SHOW_LOG` | enable cron jobs, enable debug logging |
| `METRICS_DIR` | optional; where the request logs go, default `metrics/` |

## 3. Running locally

```
# from the repo root (chat-app/)
npm install
copy .env.example .env        # fill in every value; put the DB CA at certs/ca.pem
npm start                     # http://localhost:4901

cd mobile
npm install
copy .env.example .env        # EXPO_PUBLIC_API_URL=http://localhost:4200 (lan ip on a device)
npx expo start                # android: press a, or scan with Expo Go; w for the browser build
```

The server exits at startup if MySQL is unreachable. Redis is optional for development: the
rate limiter falls back to memory when it is down.

## 4. Conventions to keep

- Route → controller → service → model. Controllers validate with `validatePayload` and map
  named errors to `RESPONSE_STATUS`; services throw with `createError`; models only run SQL.
- Every response goes through `sendSuccessResponse` / `sendErrorResponse`, so the client can
  always switch on `statusKey`.
- Every route that changes data gets `audit(...)` and `checkRateLimit(...)`.
- Secrets live in `.env` only. Never log a body without `redact`.
- The server never trusts a client-supplied user id: take it from `req.user`.

## 5. Chat features (SRS v1.1)

Implemented end to end: user discovery, one-to-one conversations, real-time text messages with
delivered and seen receipts, offline recovery, directional blocking, delete for everyone within 15
minutes, keyset history paging. Group chat, file and media messages are out of scope for now (the
schema already allows them).

### 5.1 Server layout

| Layer | Files | Notes |
|---|---|---|
| routes | `usersRtr`, `conversationsRtr`, `messagesRtr`, `healthRtr` | every chat route is `isAuthenticated` + `checkRateLimit`; mutating ones carry `audit()` |
| controllers | `usersCtrl`, `conversationsCtrl`, `messagesCtrl`, `healthCtrl` | thin: validate ids, call a service, map errors with `utils/chat.errors.js` |
| services | `usersService`, `conversationsService`, `messagesService` | the business rules; they announce what happened on `appEvents` and never know about sockets |
| models | `usersMdl`, `blocksMdl`, `conversationsMdl`, `messagesMdl` | sql only; multi-row writes use `executeTransaction` |
| socket | `server/socket/` | `index.js` attaches Socket.IO to the http server; `socket.auth.js` verifies the same jwt as the rest api (plus session and account state); `socket.handlers.js` maps events to services; `socket.relay.js` turns `appEvents` into socket emits to the `user:<id>` rooms |

Why that shape: a message sent over REST, over a socket, or by a future worker runs the same service
code and produces the same socket events, because the relay listens to the event bus rather than
being called by the sender (dependency inversion). Each module has one reason to change: the
transport, the rule, or the sql.

### 5.2 Transactions and invariants (ACID)

- A send writes the message, its receipts and the conversation's last-message pointer in one
  transaction, after taking an exclusive lock on the conversation row. Two sends into the same
  conversation therefore serialise instead of deadlocking on the foreign-key lock, and `created_at`
  is monotonic per conversation. Nothing is emitted until the commit succeeds (FR-008).
- Seen and the reconnect delivery sweep select the affected receipts `for update`, update them and
  return the ids in the same transaction, so the notifications match exactly what was written.
- `user_pair_key` (unique) is the real guard for "one direct conversation per pair"; a lost race
  surfaces as `ER_DUP_ENTRY` and is resolved by re-reading. The same pattern handles a resent
  `client_message_id` and a doubled block call.
- Delete for everyone is a single conditional update evaluated by the database clock
  (`created_at >= now(3) - interval 15 minute`), so the device clock never matters (FR-021).
- Sends from one socket are processed one at a time; the socket limiter answers immediately and the
  accepted ones queue behind each other.

### 5.3 REST endpoints (all under `/apiv1`, jwt required unless noted)

| Method and path | Purpose |
|---|---|
| `GET /health` | no auth; 503 when the database is unreachable |
| `GET /users?query=&limit=` | search by name or email; never returns the caller or anyone who blocked them; `blocked_by_me` flag |
| `GET /users/blocked` | who the caller has blocked |
| `GET /users/:id` | another member's public profile: name, email, `member_since`, `has_photo`, `blocked_by_me`, the shared `conversation_id`. No mobile number. A member who blocked the caller stays visible by name but their photo is withheld |
| `GET /users/:id/photo` | streams that member's photo; 404 when there is none, the account is inactive, or they blocked the caller (one answer for all three) |
| `POST /users/:id/block`, `DELETE /users/:id/block` | directional block / unblock, idempotent |
| `GET /conversations` | the caller's conversations with other user, last message, `unread_count`, `blocked_by_me` |
| `POST /conversations` `{ user_id }` | get or create the one-to-one conversation (201 created, 200 existing) |
| `GET /conversations/:id/messages?cursor=&limit=` | newest first, `next_cursor` / `has_more`; deleted messages come back with `content: null` |
| `POST /conversations/:id/seen` | rest fallback for `message:seen` |
| `POST /messages` `{ conversation_id, content, client_message_id? }` | rest fallback for `message:send` |
| `POST /messages/:id/delivered` | rest fallback for `message:delivered` |
| `DELETE /messages/:id` | delete own message for everyone within the window |

Chat-specific status keys: `BLOCKED`, `NOT_A_MEMBER`, `SELF_ACTION`, `DELETE_WINDOW_EXPIRED`,
`ACCOUNT_INACTIVE`. A missing conversation and a foreign one both answer `NOT_A_MEMBER` so an id
is never confirmed to exist. A logged-out session invalidates its jwt immediately on both transports.

### 5.4 Socket.IO events

Handshake: `auth: { token: <jwt> }`. Refused with `TOKEN_EXPIRED` (client refreshes over REST and
reconnects), `SESSION_EXPIRED`, `INVALID_TOKEN` or `ACCOUNT_INACTIVE`. On connect every pending
receipt of the user is marked delivered and the senders are told (offline recovery).

| Direction | Event | Payload |
|---|---|---|
| client to server | `message:send` | `{ conversation_id, content, client_message_id? }`, ack `{ ok, message, duplicate }` |
| client to server | `message:delivered` | `{ message_id }` |
| client to server | `message:seen` | `{ conversation_id }` marks every unseen message in it |
| server to recipient | `message:new` | the persisted message |
| server to sender | `message:sent` | the persisted message (other devices of the sender) |
| server to sender | `message:delivered`, `message:seen` | `{ message_id or message_ids, conversation_id, user_id, timestamp }` |
| server to members | `message:deleted` | `{ message_id, conversation_id, deleted_at }` |
| server to members | `conversation:new` | `{ conversation_id }` |
| server to caller | `error` | `{ event, statusKey, code, message }`, also returned in the ack |

The sender is always the socket's user; a `sender_id` in the payload is ignored. Limits:
`MESSAGE_MAX_LENGTH` (2000) and `MESSAGE_DELETE_WINDOW_MINUTES` (15) in `.env`; sends are limited
to a burst of 30 then 5 per second per user.

### 5.5 Tests

```
npm test            # integration suite against the configured MySQL
```

`tests/chat.test.js` boots the real app on an ephemeral port and covers AT-001 to AT-015 plus the
edge cases: duplicate conversation from either side, non-member access, payload validation,
idempotent resend, delivery and seen propagation, offline recovery, keyset paging, directional
block on both transports, delete window by server clock, inactive account, logout invalidation and
the send rate limit. It creates its own users and removes everything it wrote.
`tests/tools/peer.js` is a scripted chat partner for manual testing of the app
(`node tests/tools/peer.js`): it acknowledges, marks seen, replies, and pings every 20 s.

## 6. Mobile app (`mobile/`, Expo SDK 58, React Native)

```
cd mobile
npm install
copy .env.example .env          # EXPO_PUBLIC_API_URL=http://localhost:4200 (lan ip on a device)
npx expo start                  # android: press a, or scan with Expo Go
npx expo start --web            # browser build on http://localhost:8081, used for ui testing
```

Expo SDK 58 wants Node 22.13 or newer; it runs on Node 20 with a warning. The browser build
(`npx expo start --web`, port 8081) needs that origin in the server's `CLIENT_ORIGINS`; native builds do not.

The data layer (`store/`, `services/`, `utils/` and the contexts) is the React web client's code, ported when
that client was removed, so behaviour and messages are unchanged; the screens are the native counterparts of
its pages. Confirmations and alerts are centred dialogs; toasts appear at the top.

| Folder | Purpose |
|---|---|
| `src/theme/` | `palette.js` (the `lightColors` / `darkColors` sets and the token map built from them) and `ThemeContext` (light / dark and a 12 to 20 px font size, both persisted, as on the web client) |
| `src/store/` | `interceptor.js` and `api.service.js` from the web client: token header, newest-token capture, sign-out on `TOKEN_EXPIRED` / `SESSION_EXPIRED`, envelope unwrapping, request de-duplication, raw-body upload, blob download. The token lives in the device keychain (`src/storage/tokenStore.js`) instead of localStorage |
| `src/services/` | `auth`, `profile`, `files`, `chat` and `socket` services from the web client. The auth, profile and files ones return the server envelope and never throw; the chat ones throw it |
| `src/utils/` | `ValidateUtils.js` and `chatFormat.js` from the web client |
| `src/contexts/` | `AuthContext` (`handleLogin` / `handleLogOut`, as on the web), `ChatContext` (the web client's chat reducer and socket wiring), `MessageContext` (toasts: `useToast().success / error / warning / info`) |
| `src/screens/` | Login, Register, ForgotPassword (send code, six-box code entry, new password), Conversations (search, unread badges, pinned new-chat button), NewChat, Chat (bubbles and ticks, the ⋮ menu to block or unblock, long-press delete for everyone, retry a failed message), Profile (photo, details, password reset by code, theme, font size, blocked users, sign out), ContactInfo (another member's photo, name, email, join date, Message, block / unblock; opened from the chat header, the ⋮ menu or a chat's avatar), About (what the app does in everyday words, what the message ticks mean, privacy, account safety, what is coming later) |
| `src/navigation/` | root stack: a bottom tab bar (Chats, Profile, About) that grows by the phone's bottom inset so it sits above the gesture bar or navigation buttons, plus NewChat and Chat pushed above it; Login, Register and ForgotPassword when signed out |
| `src/components/` | `ui.js` kit (Screen, Button, TextField, Fab, Banner, EmptyState, Avatar, Badge, the centred `Dialog` used for every confirmation and alert, `PopupMenu`, and `KeyboardAvoider` / `FormScroll`, which keep the focused field and the chat composer above the on-screen keyboard; Android draws edge-to-edge and no longer makes room by itself), `OtpInput`, `VerifyOtp`, `UpdatePassword`, `MessageBubble`, `ConversationRow` |

Behaviour worth knowing: a sent message appears at once with a clock, then one tick (stored), two
ticks (delivered), blue ticks (seen); a failed send is tappable to retry or discard. Opening a chat
marks it seen; an incoming message in an open chat is acknowledged as delivered and seen in one
go. When the socket is down the app sends through REST and a banner says so. Screenshots of both
themes are in `documents/screens/`.

## 7. Still open

- Group chat UI and REST for membership (schema and services already tolerate groups).
- Attachments: `messages_lst_t.attachment_file_id` exists; the upload endpoint is image-only today.
- Push notifications, account deletion and retention rules, production TLS (`rejectUnauthorized`).
- Scaling past one node: the Socket.IO redis adapter so rooms span instances.
