import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/MessageContext';
import { handleLogin, handleLogout } from '../services/auth.service';
import * as keyStore from '../crypto/keyStore';
import { TextField, Button, Muted, Dialog } from '../components/ui';
import { AuthHeader, AuthLayout } from './LoginScreen';

/*
 * Signed in, but this phone does not have the key that opens the chats (see AuthContext 'locked').
 *  - password: the app restarted without the key (its data was cleared): the password opens the backup
 *  - recovery: the password was reset by email on a phone without the key, so the password backup is
 *    out of date: the recovery code (emailed at sign-up) opens the second backup
 * "Start fresh" makes new keys when neither is possible: new messages work, earlier ones stay unreadable.
 */
export default function UnlockScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const auth = useAuth();
  const message = useToast();
  const [mode, setMode] = useState(auth.lockReason === 'recovery' ? 'recovery' : 'password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  // in recovery mode the password is still needed to lock the key again, unless this sign-in just gave it
  const needsPassword = mode === 'password' || !keyStore.hasPendingPassword();

  // a password typed here was not checked by the server yet: a sign-in checks it (and keeps the session)
  const checkPassword = async () => {
    const result = await handleLogin({ email: auth.user.email, password });
    if (!result?.success) throw new Error(result?.statusKey === 'INVALID_CREDENTIALS' ? 'Incorrect password.' : result?.error || result?.message || 'Could not check the password.');
  };

  const unlock = async () => {
    setError(null);
    if (!password) { setError('Enter your password.'); return; }
    setBusy('Unlocking your chats...');
    try {
      const result = await keyStore.unlockWithPassword(auth.user, password);
      if (result.status === 'wrongPassword') setError('Incorrect password.');
      else if (result.status === 'needsRecovery') { setMode('recovery'); setError(null); }
      else auth.unlocked(result);
    } catch (e) {
      setError(e?.error || e?.message || 'Could not unlock. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const recover = async () => {
    setError(null);
    if (!keyStore.hasPendingPassword() && !password) { setError('Enter your current password too.'); return; }
    if (!code.trim()) { setError('Enter your recovery code.'); return; }
    setBusy('Checking the code...');
    try {
      if (!keyStore.hasPendingPassword()) await checkPassword();
      const result = await keyStore.recoverWithCode(auth.user, code, keyStore.hasPendingPassword() ? undefined : password);
      if (!result.ok) setError('That recovery code does not match. Check it and try again.');
      else { message.success('Your chats are unlocked.'); auth.unlocked(); }
    } catch (e) {
      setError(e?.message || e?.error || 'Could not unlock. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const startFresh = async () => {
    setError(null);
    if (!keyStore.hasPendingPassword() && !password) { setError('Enter your password first.'); return; }
    setBusy('Making new keys...');
    try {
      if (!keyStore.hasPendingPassword()) await checkPassword();
      const result = await keyStore.startFresh(auth.user, keyStore.hasPendingPassword() ? undefined : password);
      auth.unlocked(result);
    } catch (e) {
      setError(e?.message || e?.error || 'Could not make new keys. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => { await handleLogout(); auth.handleLogOut(); };

  return (
    <AuthLayout>
      <AuthHeader title={mode === 'recovery' ? 'Enter your recovery code' : 'Unlock your chats'}
        subtitle={mode === 'recovery'
          ? 'Your password was reset, so your chats need your recovery code once.'
          : 'Your chats are end-to-end encrypted. Enter your password to open them on this phone.'} />
      {needsPassword ? (
        <TextField label={mode === 'recovery' ? 'Current password' : 'Password'} icon="lock-closed-outline" value={password} onChangeText={setPassword}
          secureTextEntry placeholder="Your password" testID="unlock-password" onSubmitEditing={mode === 'password' ? unlock : undefined} />
      ) : null}
      {mode === 'recovery' ? (
        <>
          <TextField label="Recovery code" icon="key-outline" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" testID="unlock-code" onSubmitEditing={recover} />
          <Muted style={{ marginBottom: theme.space.lg }}>
            Find it in the email "Your YaapZone recovery code" sent to {auth.user?.email}, or wherever you saved it when you signed up.
          </Muted>
        </>
      ) : null}
      {error ? <Text style={{ color: c.danger, marginBottom: theme.space.md }} testID="unlock-error">{error}</Text> : null}
      <Button title={busy || (mode === 'recovery' ? 'Unlock with code' : 'Unlock')} loading={!!busy} onPress={mode === 'recovery' ? recover : unlock} testID="unlock-submit" />

      <View style={{ marginTop: theme.space.xl, gap: theme.space.lg, alignItems: 'center' }}>
        {mode === 'password' ? (
          <Pressable onPress={() => { setMode('recovery'); setError(null); }} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>Use my recovery code instead</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setConfirmFresh(true)} accessibilityRole="button" hitSlop={8} disabled={!!busy}>
          <Text style={{ color: c.textMuted }}>Lost the code? <Text style={{ color: c.danger, fontWeight: '600' }}>Start fresh</Text></Text>
        </Pressable>
        <Pressable onPress={signOut} accessibilityRole="button" hitSlop={8} disabled={!!busy}>
          <Text style={{ color: c.textMuted, fontWeight: '600' }}>Sign out</Text>
        </Pressable>
      </View>

      <Dialog visible={confirmFresh} icon="warning-outline" tone="danger" title="Start fresh?"
        message="You get new keys and a new recovery code. Your earlier messages can no longer be read on any phone. New messages work normally. This cannot be undone."
        actions={[{ label: 'Cancel' }, { label: 'Start fresh', style: 'destructive', onPress: startFresh, testID: 'confirm-start-fresh' }]}
        onClose={() => setConfirmFresh(false)} />
    </AuthLayout>
  );
}
