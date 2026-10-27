import React, { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, MIN_FONT, MAX_FONT, DEFAULT_FONT } from '../theme/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { getProfile } from '../services/profile.service';
import { loadPhoto, savePhoto } from '../storage/photoStore';
import { handleLogout, resetPasswordMail } from '../services/auth.service';
import { listBlocked } from '../services/chat.service';
import { Screen, Avatar, Button, Muted, Divider, Dialog, Spinner, IconButton, Section, FormScroll } from '../components/ui';
import VerifyOtp from '../components/VerifyOtp';
import UpdatePassword from '../components/UpdatePassword';
import { fullName } from '../utils/chatFormat';

// what the upload endpoint accepts (server/utils/files.utils.js)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

// label and value, as the web profile card listed the user's details
function Field({ label, value, last }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.sm, paddingHorizontal: theme.space.lg, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.border }}>
      <Muted style={{ width: 96, fontSize: theme.font.md }}>{label}</Muted>
      <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.font.md }}>{value || '-'}</Text>
    </View>
  );
}

// icon, title with a short explanation, and the control on the right (the web ProfilePage rows)
function Row({ icon, title, text, children }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, flexShrink: 1 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color={c.accent} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontWeight: '700', color: c.text, fontSize: theme.font.md }}>{title}</Text>
          <Muted>{text}</Muted>
        </View>
      </View>
      {children}
    </View>
  );
}

// segmented buttons, the native counterpart of the web Theme and FontSize switches
function Segmented({ options }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt }}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={o.onPress} disabled={o.disabled} testID={o.testID} accessibilityRole="button" accessibilityLabel={o.accessibilityLabel || o.label} accessibilityState={{ selected: !!o.active, disabled: !!o.disabled }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: theme.radius.sm, backgroundColor: o.active ? c.accent : 'transparent', opacity: o.disabled ? 0.4 : 1 }}>
          {o.icon ? <Ionicons name={o.icon} size={16} color={o.active ? '#FFFFFF' : c.textMuted} /> : null}
          <Text style={{ fontWeight: '700', fontSize: theme.font.sm, color: o.active ? '#FFFFFF' : c.textMuted }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/*
 * Ported from the web client's pages/profile/Profile.jsx and ProfilePage.jsx: the profile from the
 * server, the photo (view, or upload when there is none), password reset by email code, theme and
 * font size, and sign out. The blocked-users list is the app's own addition.
 */
export default function ProfileScreen() {
  const { theme, isDark, mode, setLightTheme, setDarkTheme, setSystemTheme, fontSize, setFontSize } = useTheme();
  const c = theme.colors;
  const authCtx = useAuth();
  const toast = useToast();
  const { unblockUser } = useChat();

  const [user, setUser] = useState(authCtx.user || {});
  const [step, setStep] = useState('send');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [messageKey, setMessageKey] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [showPhotoView, setShowPhotoView] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [blocked, setBlocked] = useState(null);

  // fresh profile from the server; the stored user only reflects the last login
  useEffect(() => {
    (async () => {
      const response = await getProfile();
      if (response?.success) {
        setUser(response.data);
        // the photo lives on this device, not on the server
        const uri = await loadPhoto(response.data?.user_id).catch(() => null);
        if (uri) setPhotoUrl(uri);
      } else {
        toast.error(response?.error || response?.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBlocked = useCallback(() => listBlocked().then(setBlocked).catch(() => setBlocked([])), []);
  useEffect(() => { loadBlocked(); }, [loadBlocked]);

  const choosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const blob = await (await fetch(asset.uri)).blob();
    const type = (asset.mimeType || blob.type || '').toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) { toast.warning('Please choose a JPG, PNG or WEBP image.'); return; }
    if ((asset.fileSize || blob.size) > MAX_BYTES) { toast.warning('The photo must be 10 MB or smaller.'); return; }

    // kept in this app's own storage on the device; nothing is uploaded
    setUploading(true);
    try {
      setPhotoUrl(await savePhoto(user?.user_id, asset.uri));
      toast.success('Profile photo updated.');
    } catch (e) {
      toast.error('Unable to save the photo on this device.');
    } finally {
      setUploading(false);
    }
  };

  const handleSendOtp = async () => {
    try {
      setSendingOtp(true);
      const response = await resetPasswordMail();
      if (response.success) {
        toast.success(response.message);
        setMessageKey(response.data.message_key);
        setStep('verify');
      } else {
        toast.error(response.error || response.message);
      }
    } catch {
      toast.error('Unable to send OTP.');
    } finally {
      setSendingOtp(false);
    }
  };

  async function confirmLogout() {
    const result = await handleLogout();
    if (result?.success) {
      toast.success('Logged out successfully!');
      authCtx.handleLogOut();
    } else {
      toast.error(result?.error || result?.message || 'Error logging out the user.', 1500);
    }
  }

  const unblock = async (u) => {
    try {
      await unblockUser(u.user_id);
      toast.success(`${fullName(u)} unblocked.`);
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not unblock.');
    }
    loadBlocked();
  };

  return (
    <Screen>
      <FormScroll contentContainerStyle={{ paddingBottom: theme.space.xxl }}>
        {/* photo, name, email */}
        <View style={{ alignItems: 'center', paddingVertical: theme.space.xl, gap: theme.space.sm }}>
          <Pressable onPress={() => (photoUrl ? setShowPhotoView(true) : choosePhoto())} disabled={uploading} accessibilityRole="button" accessibilityLabel="Profile photo">
            {photoUrl ? <Image source={{ uri: photoUrl }} style={{ width: 112, height: 112, borderRadius: 56 }} /> : <Avatar user={user} size={112} showPhoto={false} />}
            {uploading ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 56, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size="small" />
              </View>
            ) : null}
            <View style={{ position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: c.background }}>
              <Ionicons name="camera" size={16} color="#FFFFFF" />
            </View>
          </Pressable>
          <Text style={{ fontSize: theme.font.xl, fontWeight: '700', color: c.text }} testID="profile-name">{fullName(user)}</Text>
          <Muted>{user.email}</Muted>
        </View>

        <Section title="Details">
          <Field label="Username" value={user.user_nm} />
          <Field label="Email" value={user.email} />
          <Field label="Mobile" value={user.mobile_no} />
          <Field label="Last Login" value={user.last_login} last />
        </Section>

        <Section title="Reset Password">
          <View style={{ padding: theme.space.lg }}>
            {step === 'send' && (
              <Button title={sendingOtp ? 'Sending OTP...' : 'Send OTP'} onPress={handleSendOtp} loading={sendingOtp} />
            )}
            {step === 'verify' && (
              <VerifyOtp email={user.email} messageKey={messageKey} onVerified={() => setStep('update')} onResend={handleSendOtp}
                onChangeEmail={() => { setStep('send'); setMessageKey(''); }} />
            )}
            {step === 'update' && (
              <UpdatePassword email={user.email} requestFor="reset-password" messageKey={messageKey} onSuccess={() => { setStep('send'); setMessageKey(''); }} />
            )}
          </View>
        </Section>

        <Section title="Appearance">
          <Row icon="sunny-outline" title="Theme" text="Light, dark, or follow your phone's setting.">
            <Segmented options={[
              { key: 'system', label: 'System', icon: 'phone-portrait-outline', active: mode === 'system', onPress: setSystemTheme, testID: 'theme-system' },
              { key: 'light', label: 'Light', icon: 'sunny-outline', active: mode === 'light', onPress: setLightTheme, testID: 'theme-light' },
              { key: 'dark', label: 'Dark', icon: 'moon-outline', active: mode === 'dark', onPress: setDarkTheme, testID: 'theme-dark' },
            ]} />
          </Row>
          <Divider />
          <Row icon="text-outline" title="Font size" text="Scales the text in the whole app.">
            <Segmented options={[
              { key: 'decrease', label: 'A-', disabled: fontSize <= MIN_FONT, onPress: () => setFontSize(fontSize - 2), accessibilityLabel: 'Decrease font size', testID: 'font-decrease' },
              { key: 'default', label: 'A', active: fontSize === DEFAULT_FONT, onPress: () => setFontSize(DEFAULT_FONT), accessibilityLabel: 'Default font size', testID: 'font-default' },
              { key: 'increase', label: 'A+', disabled: fontSize >= MAX_FONT, onPress: () => setFontSize(fontSize + 2), accessibilityLabel: 'Increase font size', testID: 'font-increase' },
            ]} />
          </Row>
        </Section>

        <Section title="Blocked users">
          {blocked === null ? <Spinner size="small" style={{ margin: theme.space.lg }} /> : blocked.length === 0 ? (
            <Muted style={{ padding: theme.space.lg }}>You have not blocked anyone.</Muted>
          ) : blocked.map((u, i) => (
            <View key={u.user_id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, padding: theme.space.md }}>
                <Avatar user={u} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: theme.font.md }}>{fullName(u)}</Text>
                  <Muted numberOfLines={1}>{u.email}</Muted>
                </View>
                <Button title="Unblock" variant="secondary" onPress={() => unblock(u)} style={{ paddingVertical: 8, paddingHorizontal: 14 }} />
              </View>
            </View>
          ))}
        </Section>

        <Section title="Account">
          <View style={{ padding: theme.space.lg }}>
            <Muted style={{ marginBottom: theme.space.md }}>Signing out stops messages reaching this device until you sign in again.</Muted>
            <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={() => setConfirmSignOut(true)} />
          </View>
        </Section>
        <Muted style={{ textAlign: 'center', marginTop: theme.space.xl }}>Chat App v1.0.0</Muted>
      </FormScroll>

      <Dialog visible={confirmSignOut} icon="log-out-outline" tone="danger" title="Sign out?" message="You will need to sign in again to continue."
        actions={[{ label: 'Cancel' }, { label: 'Sign out', style: 'destructive', onPress: confirmLogout, testID: 'confirm-sign-out' }]}
        onClose={() => setConfirmSignOut(false)} />

      <Modal visible={showPhotoView} transparent animationType="fade" onRequestClose={() => setShowPhotoView(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl }}>
          {photoUrl ? <Image source={{ uri: photoUrl }} style={{ width: '100%', maxWidth: 420, aspectRatio: 1, borderRadius: theme.radius.lg }} resizeMode="contain" /> : null}
          <Button title="Change Photo" icon="camera-outline" onPress={() => { setShowPhotoView(false); setTimeout(choosePhoto, 250); }}
            style={{ marginTop: theme.space.xl, width: '100%', maxWidth: 420 }} />
          <IconButton name="close" size={26} color="#FFFFFF" onPress={() => setShowPhotoView(false)} accessibilityLabel="Close" style={{ position: 'absolute', top: 48, right: 16 }} />
        </View>
      </Modal>
    </Screen>
  );
}
