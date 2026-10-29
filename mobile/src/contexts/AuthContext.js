import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { registerLogoutHandler } from '../store/interceptor';
import * as tokenStore from '../store/tokenStore';
import * as socket from '../services/socket.service';
import * as keyStore from '../crypto/keyStore';

/*
 * Ported from the web client's contexts/AuthContext.jsx: handleLogin(user) after a successful login
 * call, handleLogOut() after logout, and the same handler registered with the interceptor so a dead
 * session (TOKEN_EXPIRED / SESSION_EXPIRED) signs the user out. The web kept 'isLoggedIn' and
 * 'user-data' in localStorage; here the user is in AsyncStorage and the token in the device keychain.
 * Reading them back is asynchronous, so status starts as 'loading' before 'signedIn' / 'signedOut'.
 *
 * End-to-end encryption adds 'locked': signed in, but this phone does not hold the account's private
 * key yet (the app restarted after its data was cleared, or a forgotten password needs the recovery
 * code). The unlock screen shows until the key is here; chats need it to read anything.
 * lockReason: 'password' (type the password to open the backup) or 'recovery' (the recovery code).
 * recoveryCode: a code to show once (new keys were just made for this account).
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [lockReason, setLockReason] = useState(null);
  const [recoveryCode, setRecoveryCode] = useState(null);

  // keyResult: what keyStore.unlockAfterSignIn answered for this sign-in
  const handleLogin = useCallback(async (loggedInUser, keyResult = { status: 'ready' }) => {
    await tokenStore.setUser(loggedInUser);
    setUser(loggedInUser);
    if (keyResult.status === 'needsRecovery') {
      setLockReason('recovery');
      setStatus('locked');
      return;
    }
    if (keyResult.status === 'created') setRecoveryCode(keyResult.recoveryCode);
    setLockReason(null);
    setStatus('signedIn');
  }, []);

  // the unlock screen got the key (or made new keys: show their recovery code)
  const unlocked = useCallback((result = {}) => {
    if (result.recoveryCode) setRecoveryCode(result.recoveryCode);
    setLockReason(null);
    setStatus('signedIn');
  }, []);

  const handleLogOut = useCallback(async () => {
    socket.disconnect();
    keyStore.forgetSession();
    await Promise.all([tokenStore.clearToken(), tokenStore.setUser(null)]);
    setUser(null);
    setLockReason(null);
    setRecoveryCode(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    registerLogoutHandler(handleLogOut);
    (async () => {
      const [token, savedUser] = await Promise.all([tokenStore.getToken(), tokenStore.getUser()]);
      if (token && savedUser) {
        setUser(savedUser);
        // signed in from an earlier start: the key should be in the keystore; without it, unlock first
        const id = await keyStore.loadIdentity(savedUser.user_id);
        if (id) setStatus('signedIn');
        else { setLockReason('password'); setStatus('locked'); }
      } else {
        setStatus('signedOut');
      }
    })();
    return () => registerLogoutHandler(null);
  }, [handleLogOut]);

  // after the user edits their profile: the stored copy (names in headers, the chat list) follows
  const updateUser = useCallback(async (fields) => {
    const next = { ...(await tokenStore.getUser()), ...fields };
    await tokenStore.setUser(next);
    setUser(next);
  }, []);

  const value = useMemo(() => ({
    status, user, isLoggedIn: status === 'signedIn', lockReason, recoveryCode, handleLogin, handleLogOut, updateUser, unlocked,
    showRecoveryCode: setRecoveryCode, clearRecoveryCode: () => setRecoveryCode(null),
  }), [status, user, lockReason, recoveryCode, handleLogin, handleLogOut, updateUser, unlocked]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
