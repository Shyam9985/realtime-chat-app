import './polyfill';
import * as ExpoCrypto from 'expo-crypto';
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { scryptAsync } from '@noble/hashes/scrypt';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

/*
 * End-to-end encryption, the cryptography only (keyStore.js keeps the keys).
 *
 *  - each user has a key pair (X25519): the public key is their padlock, on the server; the private
 *    key never leaves the phone except locked, in two backups on the server:
 *      * locked with a key made from the password (scrypt, slow on purpose, with a random salt)
 *      * locked with the recovery code (random, so a plain HKDF is enough)
 *  - each chat (each key version of it) has a random 32-byte chat key, sealed once per member with
 *    their padlock: a throwaway key pair + X25519 + HKDF gives the sealing key
 *  - a message is XChaCha20-Poly1305 with a random 24-byte nonce, bound to its chat, key version and
 *    sender (the additional data), so the server can neither read, change nor move it to another chat
 * Everything travels as base64. The server stores it; it can open none of it.
 */
export const KDF_PARAMS = { N: 16384, r: 8, p: 1 };
const KDF_LABEL = `n=${KDF_PARAMS.N},r=${KDF_PARAMS.r},p=${KDF_PARAMS.p}`;
const PRIVATE_KEY_AAD = utf8('yaapzone|private-key|v1');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const randomBytes = (n) => ExpoCrypto.getRandomBytes(n);

// ---- encoding (no TextEncoder / Buffer needed) ----
export function utf8(text) {
  const out = [];
  for (const ch of String(text)) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function fromUtf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let c;
    if (b < 0x80) { c = b; i += 1; }
    else if (b < 0xe0) { c = ((b & 31) << 6) | (bytes[i + 1] & 63); i += 2; }
    else if (b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
    else { c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4; }
    out += String.fromCodePoint(c);
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function fromBase64(text) {
  const clean = String(text).replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let j = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[j++] = (value >> bits) & 255; }
  }
  return out;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---- locking a 32-byte secret with a 32-byte key ----
const lock = (key, plain, aad) => {
  const nonce = randomBytes(24);
  return toBase64(concat(nonce, xchacha20poly1305(key, nonce, aad).encrypt(plain)));
};
const unlock = (key, lockedB64, aad) => {
  const all = fromBase64(lockedB64);
  return xchacha20poly1305(key, all.subarray(0, 24), aad).decrypt(all.subarray(24));   // throws on a wrong key
};

// ---- the private key's two backups ----
const passwordKey = (password, salt, params = KDF_PARAMS) => scryptAsync(utf8(password), salt, { N: params.N, r: params.r, p: params.p, dkLen: 32, asyncTick: 20 });
const parseParams = (label) => {
  const p = Object.fromEntries(String(label).split(',').map((kv) => kv.split('=')));
  return { N: Number(p.n), r: Number(p.r), p: Number(p.p) };
};

// a fresh recovery code: 160 random bits as 32 base32 letters, XXXX-XXXX-... (8 groups)
export function newRecoveryCode() {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += BASE32[(value >> bits) & 31]; }
  }
  return out.match(/.{4}/g).join('-');
}

// what the user typed back: spaces, lower case and missing dashes are fine
export const normaliseRecoveryCode = (typed) => {
  const letters = String(typed).toUpperCase().replace(/[^A-Z2-7]/g, '');
  return letters.length === 32 ? letters.match(/.{4}/g).join('-') : null;
};
const recoveryKey = (code, salt) => hkdf(sha256, utf8(code), salt, utf8('yaapzone|recovery|v1'), 32);

export async function lockWithPassword(privateKey, password) {
  const salt = randomBytes(16);
  const key = await passwordKey(password, salt);
  return { pw_locked_private_key: lock(key, privateKey, PRIVATE_KEY_AAD), pw_kdf_salt: toBase64(salt), pw_kdf_params: KDF_LABEL };
}

export function lockWithRecoveryCode(privateKey, code) {
  const salt = randomBytes(16);
  return { rc_locked_private_key: lock(recoveryKey(code, salt), privateKey, PRIVATE_KEY_AAD), rc_kdf_salt: toBase64(salt) };
}

// the private key from the password backup, or null when it does not open (wrong or old password)
export async function unlockWithPassword(keys, password) {
  try {
    const key = await passwordKey(password, fromBase64(keys.pw_kdf_salt), parseParams(keys.pw_kdf_params));
    return unlock(key, keys.pw_locked_private_key, PRIVATE_KEY_AAD);
  } catch (_) {
    return null;
  }
}

// the private key from the recovery backup, or null when the code is wrong
export function unlockWithRecoveryCode(keys, typedCode) {
  const code = normaliseRecoveryCode(typedCode);
  if (!code) return null;
  try {
    return unlock(recoveryKey(code, fromBase64(keys.rc_kdf_salt)), keys.rc_locked_private_key, PRIVATE_KEY_AAD);
  } catch (_) {
    return null;
  }
}

export const publicKeyOf = (privateKey) => x25519.getPublicKey(privateKey);

// a whole new key set: at sign-up, for an account without keys, and for "start fresh". the result's
// payload goes to the server; privateKey and recoveryCode stay on the phone (the code is also shown and
// mailed to the user)
export async function newKeySet(password) {
  const privateKey = randomBytes(32);
  const recoveryCode = newRecoveryCode();
  const payload = {
    public_key: toBase64(publicKeyOf(privateKey)),
    ...(await lockWithPassword(privateKey, password)),
    ...lockWithRecoveryCode(privateKey, recoveryCode),
    recovery_code: recoveryCode,
  };
  return { privateKey, recoveryCode, payload };
}

// ---- chat keys ----
export const newChatKey = () => randomBytes(32);

const sealKey = (shared, ephemeralPublic, recipientPublic) => hkdf(sha256, shared, concat(ephemeralPublic, recipientPublic), utf8('yaapzone|chat-key|v1'), 32);

// the chat key sealed with one member's padlock: base64(throwaway public key + nonce + sealed key)
export function sealChatKey(chatKey, recipientPublicB64) {
  const recipientPublic = fromBase64(recipientPublicB64);
  const ephemeralPrivate = randomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const key = sealKey(x25519.getSharedSecret(ephemeralPrivate, recipientPublic), ephemeralPublic, recipientPublic);
  const nonce = randomBytes(24);
  return toBase64(concat(ephemeralPublic, nonce, xchacha20poly1305(key, nonce).encrypt(chatKey)));
}

// our copy of a chat key opened with our private key (throws when it was sealed for another padlock)
export function openChatKey(lockedB64, privateKey) {
  const all = fromBase64(lockedB64);
  const ephemeralPublic = all.subarray(0, 32);
  const nonce = all.subarray(32, 56);
  const key = sealKey(x25519.getSharedSecret(privateKey, ephemeralPublic), ephemeralPublic, publicKeyOf(privateKey));
  return xchacha20poly1305(key, nonce).decrypt(all.subarray(56));
}

// ---- messages ----
const messageAad = (conversationId, keyVersion, senderId) => utf8(`yaapzone|message|v1|${conversationId}|${keyVersion}|${senderId}`);

export function encryptMessage(text, chatKey, { conversationId, keyVersion, senderId }) {
  const nonce = randomBytes(24);
  return toBase64(concat(nonce, xchacha20poly1305(chatKey, nonce, messageAad(conversationId, keyVersion, senderId)).encrypt(utf8(text))));
}

export function decryptMessage(contentB64, chatKey, { conversationId, keyVersion, senderId }) {
  const all = fromBase64(contentB64);
  return fromUtf8(xchacha20poly1305(chatKey, all.subarray(0, 24), messageAad(conversationId, keyVersion, senderId)).decrypt(all.subarray(24)));
}
