import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import * as chatApi from '../services/chat.service';
import { Screen, Avatar, GroupAvatar, Button, Muted, Dialog, ProfileSkeleton, Section, Divider, IconButton, TextField, useGroupPhoto } from '../components/ui';
import ZoomableImage from '../components/ZoomableImage';
import { removeGroupPhoto, uploadGroupPhoto } from '../services/files.service';
import { fullName } from '../utils/chatFormat';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;     // the server keeps a compressed copy of at most 1 MB

const memberSince = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// one row of the member list: photo, name ("You"), email and the Admin label
function MemberRow({ member, onPress }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${member.is_me ? 'You' : fullName(member)}${member.role === 'ADMIN' ? ', group admin' : ''}`}
      testID={`member-${member.user_id}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 10, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      <Avatar user={member} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontSize: theme.font.md, fontWeight: '600' }}>{member.is_me ? 'You' : fullName(member)}</Text>
        <Muted numberOfLines={1}>{member.email}</Muted>
      </View>
      {member.role === 'ADMIN' ? (
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: c.accentSoft }}>
          <Text style={{ color: c.accent, fontSize: theme.font.xs, fontWeight: '700' }}>Admin</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// a tappable action line (add members, exit, delete)
function ActionRow({ icon, label, onPress, danger, testID }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = danger ? c.danger : c.accent;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 14, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ fontSize: theme.font.md, fontWeight: '600', color }}>{label}</Text>
    </Pressable>
  );
}

/*
 * A group's details: name, description, who created it, and its members with their roles. Any member
 * can exit. Admins also add and remove people, make or dismiss admins, and edit the name and
 * description; a group can have several admins. After exiting, the group can be deleted from the
 * list. The screen reloads whenever the server says the group changed.
 */
export default function GroupInfoScreen({ route, navigation }) {
  const { conversationId } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const toast = useToast();
  const conversation = chat.conversations.find((x) => x.conversation_id === conversationId);
  const isMember = conversation ? conversation.is_member !== false : true;
  const [group, setGroup] = useState(null);
  const [status, setStatus] = useState('loading');   // loading | ready | error
  const [memberFor, setMemberFor] = useState(null);   // the member whose options are open
  const [confirm, setConfirm] = useState(null);       // { kind: 'exit' | 'delete' | 'remove', member? }
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [photoMenu, setPhotoMenu] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const version = chat.groupVersion[conversationId] || 0;
  const photoUrl = group?.photo_url || conversation?.photo_url || null;
  const photo = useGroupPhoto(conversationId, photoUrl);

  const load = useCallback(async () => {
    if (!isMember) { setGroup(null); setStatus('ready'); return; }
    try {
      setGroup(await chatApi.getGroup(conversationId));
      setStatus('ready');
    } catch (e) {
      if (e?.statusKey === 'NOT_A_MEMBER') { setGroup(null); setStatus('ready'); return; }
      setStatus('error');
    }
  }, [conversationId, isMember]);
  useEffect(() => { load(); }, [load, version]);

  const failed = (e, fallback) => toast.error(e?.error || e?.message || fallback);
  const admin = group?.my_role === 'ADMIN';
  const title = group?.title || conversation?.title || 'Group';

  const exitGroup = async () => {
    try { await chat.leaveGroup(conversationId); toast.success('You exited the group.'); navigation.goBack(); }
    catch (e) { failed(e, 'Could not exit the group.'); }
  };
  const deleteGroup = async () => {
    try { await chat.deleteGroup(conversationId); toast.success('Group deleted.'); navigation.popToTop(); }
    catch (e) { failed(e, 'Could not delete the group.'); }
  };
  const setRole = async (member, role) => {
    try { setGroup((await chatApi.setGroupMemberRole(conversationId, member.user_id, role)).group); toast.success(role === 'ADMIN' ? `${fullName(member)} is now an admin.` : `${fullName(member)} is no longer an admin.`); }
    catch (e) { failed(e, 'Could not change the role.'); }
  };
  const remove = async (member) => {
    try { setGroup((await chatApi.removeGroupMember(conversationId, member.user_id)).group); toast.success(`${fullName(member)} removed.`); }
    catch (e) { failed(e, 'Could not remove them.'); }
  };
  const message = async (member) => {
    try { const conv = await chat.startConversation(member.user_id); navigation.navigate('Chat', { conversationId: conv.conversation_id, title: fullName(member) }); }
    catch (e) { failed(e, 'Could not open the chat.'); }
  };
  // admins: a new group photo (the server compresses it and replaces the old one; every member sees it)
  const choosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const blob = await (await fetch(asset.uri)).blob();
    const type = (asset.mimeType || blob.type || '').toLowerCase();
    if (!PHOTO_TYPES.includes(type)) { toast.warning('Please choose a JPG, PNG or WEBP image.'); return; }
    if ((asset.fileSize || blob.size) > PHOTO_MAX_BYTES) { toast.warning('The photo must be 5 MB or smaller.'); return; }
    setPhotoBusy(true);
    try {
      const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const response = await uploadGroupPhoto(conversationId, blob, { name: `group.${extension}`, type });
      if (!response?.success) { toast.error(response?.error || response?.message || 'Could not change the group photo.'); return; }
      await load();
      chat.refreshConversation(conversationId);
      toast.success('Group photo updated.');
    } finally {
      setPhotoBusy(false);
    }
  };
  const deletePhoto = async () => {
    setPhotoBusy(true);
    try {
      const response = await removeGroupPhoto(conversationId);
      if (!response?.success && response?.statusKey !== 'NO_DATA_FOUND') { toast.error(response?.error || response?.message || 'Could not remove the group photo.'); return; }
      await load();
      chat.refreshConversation(conversationId);
      toast.success('Group photo removed.');
    } finally {
      setPhotoBusy(false);
    }
  };
  // the big picture: admins get the photo options, everyone else can open the photo
  const pressPhoto = () => { if (admin) setPhotoMenu(true); else if (photo) setViewPhoto(true); };

  const saveInfo = async () => {
    try {
      const result = await chatApi.updateGroup(conversationId, { title: editTitle, description: editDescription });
      setGroup(result.group);
      setEditOpen(false);
      if (result.changed) toast.success('Group updated.');
    } catch (e) {
      failed(e, 'Could not update the group.');
    }
  };

  if (status === 'loading' && !group) return <Screen><ProfileSkeleton rows={3} /></Screen>;
  if (status === 'error') return <Screen><View style={{ padding: theme.space.xl }}><Muted>Could not load the group.</Muted><Button title="Try again" onPress={load} style={{ marginTop: theme.space.lg }} /></View></Screen>;

  const members = group?.members || [];
  const me = members.find((m) => m.is_me);
  const ordered = me ? [me, ...members.filter((m) => !m.is_me)] : members;
  const description = group ? group.description : conversation?.description;

  const memberActions = memberFor ? [
    { label: `Message ${fullName(memberFor)}`, onPress: () => message(memberFor), testID: 'member-message' },
    { label: 'View profile', onPress: () => navigation.navigate('ContactInfo', { userId: memberFor.user_id }), testID: 'member-profile' },
    ...(admin ? [
      memberFor.role === 'ADMIN'
        ? { label: 'Dismiss as admin', onPress: () => setRole(memberFor, 'MEMBER'), testID: 'member-dismiss-admin' }
        : { label: 'Make group admin', onPress: () => setRole(memberFor, 'ADMIN'), testID: 'member-make-admin' },
      { label: `Remove ${fullName(memberFor)}`, danger: true, onPress: () => setConfirm({ kind: 'remove', member: memberFor }), testID: 'member-remove' },
    ] : []),
  ] : [];

  const dialog = !confirm ? { visible: false }
    : confirm.kind === 'exit' ? {
      visible: true, icon: 'exit-outline', tone: 'danger', title: `Exit “${title}”?`,
      message: admin && members.filter((m) => m.role === 'ADMIN').length === 1 && members.length > 1
        ? 'You are the only admin: the member who has been in the group longest becomes admin. You can still read the messages you received.'
        : 'You will stop receiving messages from this group. You can still read the messages you received.',
      actions: [{ label: 'Cancel' }, { label: 'Exit', style: 'destructive', onPress: exitGroup, testID: 'confirm-exit-group' }],
    } : confirm.kind === 'delete' ? {
      visible: true, icon: 'trash-outline', tone: 'danger', title: `Delete “${title}”?`,
      message: 'The group and its messages disappear from your chats on all your devices.',
      actions: [{ label: 'Cancel' }, { label: 'Delete', style: 'destructive', onPress: deleteGroup, testID: 'confirm-delete-group' }],
    } : {
      visible: true, icon: 'person-remove-outline', tone: 'danger', title: `Remove ${fullName(confirm.member)}?`,
      message: 'They will stop receiving messages from this group, and can still read what they received.',
      actions: [{ label: 'Cancel' }, { label: 'Remove', style: 'destructive', onPress: () => remove(confirm.member), testID: 'confirm-remove-member' }],
    };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }} testID="group-info">
        <View style={{ alignItems: 'center', paddingVertical: theme.space.xl, paddingHorizontal: theme.space.lg, gap: theme.space.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Pressable onPress={pressPhoto} disabled={photoBusy || (!admin && !photo)} accessibilityRole="button" accessibilityLabel={admin ? 'Group photo options' : 'View group photo'} testID="group-photo">
            <GroupAvatar size={112} conversationId={conversationId} photoUrl={photoUrl} />
            {admin ? (
              <View style={{ position: 'absolute', right: 2, bottom: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.surface }}>
                {photoBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="camera" size={17} color="#FFFFFF" />}
              </View>
            ) : null}
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: theme.font.xxl, fontWeight: '700', color: c.text, textAlign: 'center', flexShrink: 1 }} testID="group-title">{title}</Text>
            {admin ? <IconButton name="pencil" size={18} color={c.accent} accessibilityLabel="Edit name and description" testID="group-edit"
              onPress={() => { setEditTitle(group.title); setEditDescription(group.description || ''); setEditOpen(true); }} /> : null}
          </View>
          <Muted style={{ fontSize: theme.font.md }}>{isMember ? `Group · ${members.length} member${members.length === 1 ? '' : 's'}` : 'You’re no longer a member'}</Muted>
          {description ? <Text style={{ color: c.text, fontSize: theme.font.md, textAlign: 'center', marginTop: theme.space.xs }} testID="group-description-text">{description}</Text> : null}
          {group ? <Muted>Created by {group.created_by.user_id === chat.myId ? 'you' : group.created_by.name}, {memberSince(group.created_at)}</Muted> : null}
        </View>

        <Section title="Encryption">
          <View style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'flex-start', paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md }}>
            <Ionicons name="lock-closed-outline" size={20} color={c.accent} style={{ marginTop: 2 }} />
            <Muted style={{ flex: 1, lineHeight: Math.round(theme.font.sm * 1.5) }}>Messages in this group are end-to-end encrypted. Only its members can read them, not even YaapZone. When someone leaves, new messages use a new key they don’t have.</Muted>
          </View>
        </Section>

        {isMember && group ? (
          <Section title={`${members.length} member${members.length === 1 ? '' : 's'}`}>
            {admin ? <><ActionRow icon="person-add-outline" label="Add members" onPress={() => navigation.navigate('AddMembers', { conversationId })} testID="group-add-members" /><Divider /></> : null}
            {ordered.map((m, i) => (
              <View key={m.user_id}>
                {i > 0 ? <Divider inset={72} /> : null}
                <MemberRow member={m} onPress={m.is_me ? undefined : () => setMemberFor(m)} />
              </View>
            ))}
          </Section>
        ) : null}

        <Section title={isMember ? 'Leave' : 'This group'}>
          {isMember
            ? <ActionRow icon="exit-outline" label="Exit group" danger onPress={() => setConfirm({ kind: 'exit' })} testID="group-exit" />
            : <ActionRow icon="trash-outline" label="Delete group" danger onPress={() => setConfirm({ kind: 'delete' })} testID="group-delete" />}
          <Divider />
          <Muted style={{ paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, lineHeight: Math.round(theme.font.sm * 1.5) }}>
            {isMember
              ? 'Anyone can exit a group. You keep the messages you received, but cannot send new ones.'
              : 'You exited this group or were removed. Deleting it removes it from your chats.'}
          </Muted>
        </Section>
      </ScrollView>

      <Dialog visible={!!memberFor} icon="person-circle-outline" title={memberFor ? fullName(memberFor) : ''} onClose={() => setMemberFor(null)}
        actions={[{ label: 'Close' }]}>
        <View style={{ marginTop: theme.space.md }} testID="member-options">
          {memberActions.map((a, i) => (
            <View key={a.label}>
              {i > 0 ? <Divider /> : null}
              <Pressable onPress={() => { setMemberFor(null); setTimeout(a.onPress, Platform.OS === 'ios' ? 350 : 0); }} accessibilityRole="button" testID={a.testID}
                style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ color: a.danger ? c.danger : c.text, fontSize: theme.font.md, fontWeight: '600', textAlign: 'center' }}>{a.label}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </Dialog>

      <Dialog {...dialog} onClose={() => setConfirm(null)} />

      <Dialog visible={photoMenu} icon="image-outline" title="Group photo" onClose={() => setPhotoMenu(false)}
        message={photo ? 'Everyone in the group sees this photo.' : 'Add a photo everyone in the group sees.'}
        actions={[
          ...(photo ? [{ label: 'View', onPress: () => setTimeout(() => setViewPhoto(true), 250) }] : []),
          ...(photo ? [{ label: 'Remove', style: 'destructive', onPress: deletePhoto, testID: 'group-photo-remove' }] : []),
          { label: photo ? 'Change' : 'Choose', style: 'primary', onPress: () => setTimeout(choosePhoto, 250), testID: 'group-photo-choose' },
        ]} />

      <Modal visible={viewPhoto} transparent animationType="fade" onRequestClose={() => setViewPhoto(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl }}>
          {photo ? <ZoomableImage uri={photo} style={{ width: '100%', maxWidth: 420, aspectRatio: 1, borderRadius: theme.radius.lg }} testID="group-photo-zoom" /> : null}
          <IconButton name="close" size={26} color="#FFFFFF" onPress={() => setViewPhoto(false)} accessibilityLabel="Close" style={{ position: 'absolute', top: 48, right: 16 }} />
        </View>
      </Modal>

      <Dialog visible={editOpen} icon="pencil-outline" title="Edit group" message="The name and description are the same for everyone in the group."
        onClose={() => setEditOpen(false)} actions={[{ label: 'Cancel' }, { label: 'Save', style: 'primary', onPress: saveInfo, testID: 'group-edit-save' }]}>
        <TextField value={editTitle} onChangeText={(t) => setEditTitle(t.slice(0, 100))} placeholder="Group name" autoFocus
          style={{ marginTop: theme.space.md, marginBottom: theme.space.sm }} testID="group-edit-title" accessibilityLabel="Group name" />
        <TextField value={editDescription} onChangeText={(t) => setEditDescription(t.slice(0, 500))} placeholder="Description (optional)" multiline
          style={{ marginBottom: 0 }} testID="group-edit-description" accessibilityLabel="Group description" />
      </Dialog>
    </Screen>
  );
}
