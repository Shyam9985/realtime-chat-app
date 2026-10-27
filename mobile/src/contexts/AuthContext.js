import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { registerLogoutHandler } from '../store/interceptor';
import * as tokenStore from '../store/tokenStore';
import * as socket from '../services/socket.service';

/*
 * Ported from the web client's contexts/AuthContext.jsx: handleLogin(user) after a successful login
 * call, handleLogOut() after logout, and the same handler registered with the interceptor so a dead
 * session (TOKEN_EXPIRED / SESSION_EXPIRED) signs the user out. The web kept 'isLoggedIn' and
 * 'user-data' in localStorage; here the user is in AsyncStorage and the token in the device keychain.
 * Reading them back is asynchronous, so status starts as 'loading' before 'signedIn' / 'signedOut'.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  const handleLogin = useCallback(async (loggedInUser) => {
    await tokenStore.setUser(loggedInUser);
    setUser(loggedInUser);
    setStatus('signedIn');
  }, []);

  const handleLogOut = useCallback(async () => {
    socket.disconnect();
    await Promise.all([tokenStore.clearToken(), tokenStore.setUser(null)]);
    setUser(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    registerLogoutHandler(handleLogOut);
    (async () => {
      const [token, savedUser] = await Promise.all([tokenStore.getToken(), tokenStore.getUser()]);
      if (token && savedUser) {
        setUser(savedUser);
        setStatus('signedIn');
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

  const value = useMemo(() => ({ status, user, isLoggedIn: status === 'signedIn', handleLogin, handleLogOut, updateUser }), [status, user, handleLogin, handleLogOut, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
