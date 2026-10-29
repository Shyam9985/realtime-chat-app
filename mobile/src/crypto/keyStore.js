import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as e2ee from './e2ee';
import { get, patch, post, put } from '../store/api.service';

/*
 * Where the keys live on this phone, and the account flows around them.
 *  - the user's private key: the device keystore (expo-secure-store), one entry per account. Signing out
 *    keeps it, so a password forgotten later can still be re-locked from this phone; clearing the app's
 *    data removes it, and the next sign-in brings it back from the password backup
 *  - this user's locked copies of chat keys: async storage (they are useless without the private key),
 *    opened chat keys only in memory
 * Everything here works for the background push task too (no React).
 */
const IDENTITY = (userId) => `yaapzone.e2ee.identity.${userId}`;
const LAST_USER = 'yaapzone.e2ee.last-user';
const CHAT_KEYS = (userId) => `yaapzone.e2ee.chat-keys.${userId}`;

let identity = null;                 // { userId, privateKey, publicKey, keyVersion }
const opened = new Map();            // `${conversationId}:${keyVersion}` -> chat key (this session)
const freshKeys = new Map();         // email -> { privateKey, publicKey } made at sign-up (spares a second scrypt)
let pendingPassword = null;          // the password of a sign-in that still has to unlock the keys

const unwrap = (promise) => promise.then((r) => r.data);

// ---- the user's own keys ----
export async function loadIdentity(userId) {
  if (identity?.userId === Number(userId)) return identity;
  try {
    const raw = await SecureStore.getItemAsync(IDENTITY(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    identity = { userId: Number(userId), privateKey: e2ee.fromBase64(saved.privateKey), publicKey: saved.publicKey, keyVersion: saved.keyVersion };
    return identity;
  } catch (_) {
    return null;
  }
}

async function saveIdentity(user, privateKey, keyVersion) {
  const publicKey = e2ee.toBase64(e2ee.publicKeyOf(privateKey));
  await SecureStore.setItemAsync(IDENTITY(user.user_id), JSON.stringify({ privateKey: e2ee.toBase64(privateKey), publicKey, keyVersion }));
  await SecureStore.setItemAsync(LAST_USER, JSON.stringify({ user_id: user.user_id, email: String(user.email || '').toLowerCase() }));
  identity = { userId: Number(user.user_id), privateKey, publicKey, keyVersion };
  return identity;
}

export const currentIdentity = () => identity;

// sign-out: the keys stay on the phone (see the top), only this session forgets them
export function forgetSession() {
  identity = null;
  opened.clear();
  pendingPassword = null;
}

// the account last signed in on this phone, when it is this email (the forgotten-password screen)
async function identityForEmail(email) {
  try {
    const last = JSON.parse((await SecureStore.getItemAsync(LAST_USER)) || 'null');
    if (!last || last.email !== String(email).trim().toLowerCase()) return null;
    return loadIdentity(last.user_id);
  } catch (_) {
    return null;
  }
}

// ---- sign-up ----
// the keys for a new account (slow: the password key is made with scrypt). the payload goes with the
// sign-up; the recovery code is shown to the user
export async function keysForSignUp(email, password) {
  const set = await e2ee.newKeySet(password);
  freshKeys.set(String(email).trim().toLowerCase(), { privateKey: set.privateKey, publicKey: set.payload.public_key });
  return { payload: set.payload, recoveryCode: set.recoveryCode };
}

/*
 * After a successful sign-in: the private key for this account, ready to use. Answers
 *  - { status: 'ready' }                 the keys are on this phone (and the backup is up to date)
 *  - { status: 'created', recoveryCode } the account had no keys: they were made now (show the code)
 *  - { status: 'needsRecovery' }         the password backup is out of date (a forgotten password was
 *                                        reset on a phone without the key): ask for the recovery code
 */
export async function unlockAfterSignIn(user, keys, password) {
  pendingPassword = password;
  if (!keys) return createKeys(user, password);

  // this phone already has these keys (a sign-in after signing out), or just made them at sign-up
  const local = await loadIdentity(user.user_id);
  const fresh = freshKeys.get(String(user.email).toLowerCase());
  let privateKey = null;
  if (local && local.publicKey === keys.public_key) privateKey = local.privateKey;
  else if (fresh && fresh.publicKey === keys.public_key) privateKey = fresh.privateKey;
  else if (keys.pw_backup_valid) privateKey = await e2ee.unlockWithPassword(keys, password);

  if (!privateKey) return { status: 'needsRecovery' };
  await saveIdentity(user, privateKey, keys.key_version);
  freshKeys.delete(String(user.email).toLowerCase());
  // the backup was locked with an old password, but this phone had the key: lock it with the new one
  if (!keys.pw_backup_valid) await uploadPasswordBackup(password).catch(() => {});
  pendingPassword = null;
  return { status: 'ready' };
}

// an account from before encryption (or "start fresh"): a new key set, uploaded, mailed and shown
async function createKeys(user, password) {
  const set = await e2ee.newKeySet(password);
  const { keys } = await unwrap(put('keys/me', set.payload));
  await saveIdentity(user, set.privateKey, keys.key_version);
  opened.clear();
  pendingPassword = null;
  return { status: 'created', recoveryCode: set.recoveryCode };
}

// the keys of the signed-in account from the server (the unlock screen after the app restarts)
export const fetchMyKeys = () => unwrap(get('keys/me')).then((d) => d.keys).catch((error) => {
  if (error?.statusKey === 'NO_KEYS') return null;
  throw error;
});

export const hasPendingPassword = () => !!pendingPassword;

// the unlock screen with the password typed in (after an app restart, the keys missing on this phone).
// here the password was not checked by a sign-in, so a backup that does not open means a wrong password
export async function unlockWithPassword(user, password) {
  const keys = await fetchMyKeys();
  const result = await unlockAfterSignIn(user, keys, password);
  if (result.status === 'needsRecovery' && keys?.pw_backup_valid) { pendingPassword = null; return { status: 'wrongPassword' }; }
  return result;
}

// the recovery code opens the second backup; the password backup is then locked with the current password
export async function recoverWithCode(user, typedCode, password = pendingPassword) {
  const keys = await fetchMyKeys();
  const privateKey = keys ? e2ee.unlockWithRecoveryCode(keys, typedCode) : null;
  if (!privateKey) return { ok: false, reason: 'wrongCode' };
  await saveIdentity(user, privateKey, keys.key_version);
  if (password) await uploadPasswordBackup(password);
  pendingPassword = null;
  return { ok: true };
}

// "start fresh": new keys; earlier messages cannot be read on any phone after this
export async function startFresh(user, password = pendingPassword) {
  if (!password) throw new Error('password needed');
  return createKeys(user, password);
}

// the password backup locked again with this password (after a recovery, or a backup out of date)
async function uploadPasswordBackup(password) {
  const backup = await passwordBackupFor(password);
  if (backup) await patch('keys/me/password-backup', backup);
}

// the backup that goes with a password change, when this phone has the key (else null: the server
// marks the old backup out of date and the next sign-in asks for the recovery code)
export async function passwordBackupFor(newPassword, email = null) {
  const id = email ? await identityForEmail(email) : identity;
  if (!id) return null;
  return { key_version: id.keyVersion, public_key: id.publicKey, ...(await e2ee.lockWithPassword(id.privateKey, newPassword)) };
}

// a new recovery code replaces the old one (mailed and shown)
export async function newRecoveryCode() {
  if (!identity) throw new Error('locked');
  const code = e2ee.newRecoveryCode();
  await put('keys/me/recovery', { key_version: identity.keyVersion, public_key: identity.publicKey, ...e2ee.lockWithRecoveryCode(identity.privateKey, code), recovery_code: code });
  return code;
}

// ---- chat keys ----
const slot = (conversationId, keyVersion) => `${conversationId}:${keyVersion}`;

async function readLocked(userId) {
  try { return JSON.parse((await AsyncStorage.getItem(CHAT_KEYS(userId))) || '{}'); } catch (_) { return {}; }
}

// this user's locked copies from the server (one chat, or all), kept on the phone
export async function fetchChatKeys(conversationId = null) {
  if (!identity) return;
  const { keys } = await unwrap(get('keys/conversations', conversationId ? { conversation_id: conversationId } : {}));
  const stored = await readLocked(identity.userId);
  for (const k of keys) stored[slot(k.conversation_id, k.key_version)] = { locked: k.locked_key, ukv: k.user_key_version };
  await AsyncStorage.setItem(CHAT_KEYS(identity.userId), JSON.stringify(stored));
}

// the chat key of one version, opened; fetched from the server once if this phone does not have it.
// null: no copy for us (sent before we joined, or before "start fresh")
export async function chatKey(conversationId, keyVersion, { fetch = true } = {}) {
  if (!identity || !keyVersion) return null;
  const id = slot(conversationId, keyVersion);
  if (opened.has(id)) return opened.get(id);
  let entry = (await readLocked(identity.userId))[id];
  if (!entry && fetch) {
    await fetchChatKeys(conversationId).catch(() => {});
    entry = (await readLocked(identity.userId))[id];
  }
  if (!entry) return null;
  try {
    const key = e2ee.openChatKey(entry.locked, identity.privateKey);
    opened.set(id, key);
    return key;
  } catch (_) {
    return null;     // sealed for an older padlock of ours
  }
}

/*
 * The key to send with in this chat: its current version, or a new version made here when there is
 * none yet, a member left or joined, or someone's padlock changed. The new chat key is sealed once per
 * member and uploaded; if another phone made that version first, theirs is used instead.
 */
export async function sendKey(conversationId, attempt = 0) {
  const state = await unwrap(get(`conversations/${conversationId}/keys`));
  if (state.current_key_version > 0 && !state.needs_new_key) {
    const key = await chatKey(conversationId, state.current_key_version);
    if (key) return { key, keyVersion: state.current_key_version };
  }
  const keyVersion = state.current_key_version + 1;
  const key = e2ee.newChatKey();
  const copies = state.members.filter((m) => m.public_key).map((m) => ({
    user_id: m.user_id, user_key_version: m.key_version, locked_key: e2ee.sealChatKey(key, m.public_key),
  }));
  try {
    await post(`conversations/${conversationId}/keys`, { key_version: keyVersion, copies });
    opened.set(slot(conversationId, keyVersion), key);
    return { key, keyVersion };
  } catch (error) {
    if (error?.statusKey === 'KEY_OUTDATED' && attempt < 2) return sendKey(conversationId, attempt + 1);
    throw error;
  }
}

// the send key, remembered per chat until the server says it changed (forget it then)
const sendKeys = new Map();
export async function currentSendKey(conversationId) {
  if (sendKeys.has(conversationId)) return sendKeys.get(conversationId);
  const k = await sendKey(conversationId);
  sendKeys.set(conversationId, k);
  return k;
}
export const forgetSendKey = (conversationId) => sendKeys.delete(conversationId);

// ---- messages ----
export async function encryptText(conversationId, text) {
  const { key, keyVersion } = await currentSendKey(conversationId);
  return { content: e2ee.encryptMessage(text, key, { conversationId, keyVersion, senderId: identity.userId }), key_version: keyVersion };
}

/*
 * Encrypts the text for this chat and hands { content, key_version } to send(). When the server answers
 * that the chat has a newer key (a member left or joined, or a race with another phone), the key is
 * fetched or made again and the text is encrypted and sent once more.
 */
export async function sendEncrypted(conversationId, text, send) {
  for (let attempt = 0; ; attempt += 1) {
    const encrypted = await encryptText(conversationId, text);
    try {
      return await send(encrypted);
    } catch (error) {
      if (error?.statusKey === 'KEY_OUTDATED' && attempt < 2) { forgetSendKey(conversationId); continue; }
      throw error;
    }
  }
}

export const UNREADABLE = '🔒 This message can\'t be read on this device.';

// one encrypted text back to plain text (null when this phone has no key for it)
export async function decryptText(content, { conversationId, keyVersion, senderId }) {
  const key = await chatKey(conversationId, keyVersion);
  if (!key) return null;
  try { return e2ee.decryptMessage(content, key, { conversationId, keyVersion, senderId }); } catch (_) { return null; }
}

/*
 * Every encrypted text in an answer from the server (messages, the message they reply to, the chat
 * list's previews, edit versions, scheduled messages) replaced by its plain text. The chat and sender
 * come from the nearest object that names them; ctx gives them when the answer itself does not.
 */
export async function openTree(value, ctx = {}) {
  if (Array.isArray(value)) return Promise.all(value.map((v) => openTree(v, ctx)));
  if (!value || typeof value !== 'object') return value;
  const here = {
    conversationId: value.conversation_id ?? ctx.conversationId,
    senderId: value.sender_id ?? ctx.senderId,
  };
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    // a reply quotes a message of the same chat by its own sender
    out[k] = (v && typeof v === 'object') ? await openTree(v, { conversationId: here.conversationId, senderId: k === 'reply_to' ? v?.sender_id : here.senderId }) : v;
  }
  if (out.enc_format === 1 && typeof out.content === 'string' && out.content) {
    const plain = await decryptText(out.content, { conversationId: here.conversationId, keyVersion: out.key_version, senderId: here.senderId });
    out.content = plain ?? UNREADABLE;
    if (plain === null) out.unreadable = true;
  }
  return out;
}

// the chat list: each preview opened with its chat and sender
export const openConversations = (conversations) => Promise.all(conversations.map((c) => openTree(
  { ...c, last_message: c.last_message ? { ...c.last_message, conversation_id: c.conversation_id } : null },
)));

export const decryptedForPush = decryptText;
