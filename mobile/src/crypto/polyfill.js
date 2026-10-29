import * as ExpoCrypto from 'expo-crypto';

// the encryption libraries look for crypto.getRandomValues when they load; Hermes has none, so the
// phone's secure random generator (expo-crypto) stands in. imported first, from index.js
if (typeof globalThis.crypto !== 'object' || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = { ...(globalThis.crypto || {}), getRandomValues: ExpoCrypto.getRandomValues };
}
