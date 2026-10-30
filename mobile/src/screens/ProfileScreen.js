import React, { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, MIN_FONT, MAX_FONT, DEFAULT_FONT } from '../theme/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { deleteAccount, getProfile, updateProfile } from '../services/profile.service';
import { deletePhoto, loadPhoto, savePhoto } from '../store/photoStore';
import * as keyStore from '../crypto/keyStore';
import { getProfilePhoto, pickedFileSize, pickedImageType, removeProfilePhoto, uploadPickedPhoto } from '../services/files.service';
import { handleLogout, resetPasswordMail } from '../services/auth.service';
import { listBlocked } from '../services/chat.service';
import { APP_VERSION } from '../config';
import { Screen, Avatar, Button, Muted, Divider, Dialog, Spinner, IconButton, Section, FormScroll, PeopleListSkeleton, TextField } from '../components/ui';
import ZoomableImage from '../components/ZoomableImage';
import DateField from '../components/DateField';
import VerifyOtp from '../components/VerifyOtp';
import UpdatePassword from '../components/UpdatePassword';
import * as validate from '../utils/ValidateUtils';
import { birthDateLabel, fullName } from '../utils/chatFormat';

// what the upload endpoint accepts (server/utils/files.utils.js); the server stores a compressed copy of at most 1 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

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

// a setting: the title and its control on one line, the explanation on its own line underneath.
// on a very narrow screen or at the largest font the control wraps below the title instead of clipping
function Row({ title, text, children }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, gap: theme.space.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: theme.space.md, rowGap: theme.space.sm }}>
        <Text style={{ fontWeight: '700', color: c.text, fontSize: theme.font.md }}>{title}</Text>
        {children}
      </View>
      <Muted style={{ lineHeight: Math.round(theme.font.sm * 1.45) }}>{text}</Muted>
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
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 10, borderRadius: theme.radius.sm, backgroundColor: o.active ? c.accent : 'transparent', opacity: o.disabled ? 0.4 : 1 }}>
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
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false);
  const [makingCode, setMakingCode] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // the account and everything it wrote are deleted for good; the password is asked again first
  const confirmDeleteAccount = async () => {
    const password = deletePassword;
    setDeletePassword('');
    if (!password) { toast.warning('Enter your password to delete your account.'); return; }
    setDeleting(true);
    const result = await deleteAccount(password, user?.user_id);
    setDeleting(false);
    if (!result?.success) {
      toast.error(result?.statusKey === 'INVALID_CREDENTIALS' ? 'Incorrect password. Your account was not deleted.' : result?.error || result?.message || 'Could not delete your account.');
      return;
    }
    toast.success('Your account and all your data were deleted.');
    authCtx.handleLogOut();
  };

  // a new recovery code (mailed and shown once); the old one stops opening the backup
  const newRecoveryCode = async () => {
    setMakingCode(true);
    try { authCtx.showRecoveryCode(await keyStore.newRecoveryCode()); }
    catch (e) { toast.error(e?.error || e?.message || 'Could not make a new recovery code.'); }
    finally { setMakingCode(false); }
  };
  const [blocked, setBlocked] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // fresh profile from the server; the stored user only reflects the last login
  useEffect(() => {
    (async () => {
      const response = await getProfile();
      if (response?.success) {
        setUser(response.data);
        // this phone's own copy first (instant, offline); otherwise the one on the server (a new phone)
        const uri = await loadPhoto(response.data?.user_id).catch(() => null);
        if (uri) setPhotoUrl(uri);
        else if (response.data?.profile_photo) setPhotoUrl(await getProfilePhoto());
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
    const type = pickedImageType(asset, null);
    if (!ALLOWED_TYPES.includes(type)) { toast.warning('Please choose a JPG, PNG or WEBP image.'); return; }
    if (pickedFileSize(asset) > MAX_BYTES) { toast.warning('The photo must be 5 MB or smaller.'); return; }

    // uploaded so other members see it (the server compresses it and replaces the old one), and kept on
    // this phone too, so it shows at once and offline
    setUploading(true);
    try {
      const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const response = await uploadPickedPhoto('files/upload', asset.uri, { name: `profile.${extension}`, type });
      if (!response?.success) { toast.error(response?.error || response?.message || 'Could not upload the photo.'); return; }
      setPhotoUrl(await savePhoto(user?.user_id, asset.uri));
      const photoPath = response.data?.file_path || null;
      setUser((u) => ({ ...u, profile_photo: photoPath }));
      authCtx.updateUser({ profile_photo_url: photoPath });
      toast.success('Profile photo updated. Your friends see it too.');
    } catch (e) {
      toast.error('Could not update the photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // removed on the server (row and file) and from this phone; friends see the initials again
  const removePhoto = async () => {
    setUploading(true);
    try {
      const response = await removeProfilePhoto();
      // already gone on the server (404) still clears this phone's copy
      if (!response?.success && response?.statusKey !== 'NO_DATA_FOUND') { toast.error(response?.error || response?.message || 'Could not remove the photo.'); return; }
      await deletePhoto(user?.user_id).catch(() => {});
      setPhotoUrl(null);
      setUser((u) => ({ ...u, profile_photo: null }));
      authCtx.updateUser({ profile_photo_url: null });
      toast.success('Profile photo removed.');
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

  // edit profile: the same rules as sign-up. only what changed is sent; a blank last name or mobile clears it
  const startEdit = () => {
    setForm({ firstName: user.first_nm || '', lastName: user.last_nm || '', mobile: user.mobile_no || '', dateOfBirth: user.date_of_birth || '' });
    setFormErrors({});
    setEditing(true);
  };
  const setField = (name) => (value) => { setForm((f) => ({ ...f, [name]: value })); setFormErrors((e) => ({ ...e, [name]: undefined })); };
  const saveProfile = async () => {
    const errors = {};
    const first = validate.isValidPersonName(form.firstName, { label: 'First name' });
    if (!first.status) errors.firstName = first.message;
    if (form.lastName.trim()) { const last = validate.isValidPersonName(form.lastName, { label: 'Last name' }); if (!last.status) errors.lastName = last.message; }
    if (form.mobile.trim()) { const mobile = validate.isValidMobile(form.mobile); if (!mobile.status) errors.mobile = mobile.message; }
    const dob = validate.isValidBirthDate(form.dateOfBirth);
    if (!dob.status) errors.dateOfBirth = dob.message;
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    const changes = {};
    if (form.firstName.trim() !== (user.first_nm || '')) changes.fst_nm = form.firstName.trim();
    if (form.lastName.trim() !== (user.last_nm || '')) changes.lst_nm = form.lastName.trim();
    if (form.mobile.trim() !== (user.mobile_no || '')) changes.mobile = form.mobile.trim();
    if (form.dateOfBirth !== (user.date_of_birth || '')) changes.date_of_birth = form.dateOfBirth;
    if (!Object.keys(changes).length) { setEditing(false); return; }

    setSaving(true);
    const response = await updateProfile(changes);
    setSaving(false);
    if (response?.success) {
      setUser(response.data);
      authCtx.updateUser({ first_nm: response.data.first_nm, last_nm: response.data.last_nm, mobile_no: response.data.mobile_no });
      setEditing(false);
      toast.success('Profile updated.');
    } else {
      toast.error(response?.error || response?.message || 'Could not update your profile.');
    }
  };

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
          {!editing ? <Button title="Edit profile" icon="create-outline" variant="secondary" onPress={startEdit} style={{ marginTop: theme.space.sm, paddingVertical: 8 }} testID="profile-edit-open" /> : null}
        </View>

        <Section title={editing ? 'Edit profile' : 'Details'}>
          {editing ? (
            <View style={{ padding: theme.space.lg }} testID="profile-edit">
              <TextField label="First Name" icon="person-outline" value={form.firstName} onChangeText={setField('firstName')} error={formErrors.firstName} autoComplete="given-name" testID="edit-first" />
              <TextField label="Last Name (optional)" icon="person-outline" value={form.lastName} onChangeText={setField('lastName')} error={formErrors.lastName} autoComplete="family-name" testID="edit-last" />
              <TextField label="Mobile Number (optional)" icon="call-outline" value={form.mobile} onChangeText={setField('mobile')} error={formErrors.mobile} keyboardType="phone-pad" placeholder="10 digit mobile number" testID="edit-mobile" />
              <DateField label="Date of Birth" value={form.dateOfBirth} onChange={setField('dateOfBirth')} error={formErrors.dateOfBirth} placeholder="Choose your date of birth"
                maximumDate={new Date()} minimumDate={new Date(1900, 0, 1)} initial={new Date(2000, 0, 1)} testID="edit-dob" />
              <Muted style={{ marginBottom: theme.space.lg }}>Your email is your sign-in, so it can’t be changed here. Your mobile number and date of birth are never shown to others.</Muted>
              <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} testID="profile-cancel" />
                <Button title={saving ? 'Saving…' : 'Save'} onPress={saveProfile} loading={saving} style={{ flex: 1 }} testID="profile-save" />
              </View>
            </View>
          ) : (
            <>
              <Field label="Username" value={user.user_nm} />
              <Field label="Email" value={user.email} />
              <Field label="Mobile" value={user.mobile_no} />
              <Field label="Birthday" value={birthDateLabel(user.date_of_birth)} />
              <Field label="Last Login" value={user.last_login} last />
            </>
          )}
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

        <Section title="Encryption">
          <View style={{ padding: theme.space.lg }}>
            <Muted style={{ marginBottom: theme.space.md }}>Your chats are end-to-end encrypted: only your phones can read them. Lost your recovery code? Make a new one; the old one stops working.</Muted>
            <Button title={makingCode ? 'Making a new code...' : 'New recovery code'} icon="key-outline" variant="secondary" loading={makingCode} onPress={newRecoveryCode} testID="new-recovery-code" />
          </View>
        </Section>

        <Section title="Appearance">
          <Row title="Theme" text="Light, dark, or follow your phone's setting.">
            <Segmented options={[
              { key: 'system', label: 'System', icon: 'phone-portrait-outline', active: mode === 'system', onPress: setSystemTheme, testID: 'theme-system' },
              { key: 'light', label: 'Light', icon: 'sunny-outline', active: mode === 'light', onPress: setLightTheme, testID: 'theme-light' },
              { key: 'dark', label: 'Dark', icon: 'moon-outline', active: mode === 'dark', onPress: setDarkTheme, testID: 'theme-dark' },
            ]} />
          </Row>
          <Divider />
          <Row title="Font size" text="Scales the text in the whole app.">
            <Segmented options={[
              { key: 'decrease', label: 'A-', disabled: fontSize <= MIN_FONT, onPress: () => setFontSize(fontSize - 2), accessibilityLabel: 'Decrease font size', testID: 'font-decrease' },
              { key: 'default', label: 'A', active: fontSize === DEFAULT_FONT, onPress: () => setFontSize(DEFAULT_FONT), accessibilityLabel: 'Default font size', testID: 'font-default' },
              { key: 'increase', label: 'A+', disabled: fontSize >= MAX_FONT, onPress: () => setFontSize(fontSize + 2), accessibilityLabel: 'Increase font size', testID: 'font-increase' },
            ]} />
          </Row>
        </Section>

        <Section title="Blocked users">
          {blocked === null ? <PeopleListSkeleton rows={2} /> : blocked.length === 0 ? (
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
            <Muted style={{ marginTop: theme.space.xl, marginBottom: theme.space.md }}>Deleting your account removes your profile, photos, keys and every message you sent, for everyone. It cannot be undone.</Muted>
            <Button title={deleting ? 'Deleting your account...' : 'Delete account'} variant="danger" icon="trash-outline" loading={deleting}
              onPress={() => { setDeletePassword(''); setDeleteOpen(true); }} testID="delete-account" />
          </View>
        </Section>
        <Muted style={{ textAlign: 'center', marginTop: theme.space.xl }}>YaapZone v{APP_VERSION}</Muted>
      </FormScroll>

      <Dialog visible={confirmSignOut} icon="log-out-outline" tone="danger" title="Sign out?" message="You will need to sign in again to continue."
        actions={[{ label: 'Cancel' }, { label: 'Sign out', style: 'destructive', onPress: confirmLogout, testID: 'confirm-sign-out' }]}
        onClose={() => setConfirmSignOut(false)} />

      <Dialog visible={deleteOpen} icon="warning-outline" tone="danger" title="Delete your account?" onClose={() => setDeleteOpen(false)}
        message="This deletes your account and everything in it, for good: your profile and photo, your encryption keys, every message you sent (also in other people's chats), your one-to-one chats and the groups only you are in. This cannot be undone."
        actions={[{ label: 'Cancel' }, { label: 'Delete', style: 'destructive', onPress: confirmDeleteAccount, testID: 'confirm-delete-account' }]}>
        <TextField label="Your password" icon="lock-closed-outline" value={deletePassword} onChangeText={setDeletePassword} secureTextEntry
          placeholder="Type your password to confirm" style={{ marginTop: theme.space.lg }} testID="delete-account-password" />
      </Dialog>

      <Dialog visible={confirmRemovePhoto} icon="trash-outline" tone="danger" title="Remove profile photo?" message="Your friends will see your initials instead."
        actions={[{ label: 'Cancel' }, { label: 'Remove', style: 'destructive', onPress: removePhoto, testID: 'confirm-remove-photo' }]}
        onClose={() => setConfirmRemovePhoto(false)} />

      <Modal visible={showPhotoView} transparent animationType="fade" onRequestClose={() => setShowPhotoView(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl }}>
          {photoUrl ? <ZoomableImage uri={photoUrl} style={{ width: '100%', maxWidth: 420, aspectRatio: 1, borderRadius: theme.radius.lg }} testID="photo-zoom" /> : null}
          <Button title="Change Photo" icon="camera-outline" onPress={() => { setShowPhotoView(false); setTimeout(choosePhoto, 250); }}
            style={{ marginTop: theme.space.xl, width: '100%', maxWidth: 420 }} />
          <Button title="Remove Photo" icon="trash-outline" variant="danger" onPress={() => { setShowPhotoView(false); setTimeout(() => setConfirmRemovePhoto(true), 250); }}
            style={{ marginTop: theme.space.md, width: '100%', maxWidth: 420 }} testID="photo-remove" />
          <IconButton name="close" size={26} color="#FFFFFF" onPress={() => setShowPhotoView(false)} accessibilityLabel="Close" style={{ position: 'absolute', top: 48, right: 16 }} />
        </View>
      </Modal>
    </Screen>
  );
}
