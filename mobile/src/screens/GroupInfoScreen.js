import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import * as chatApi from '../services/chat.service';
import { Screen, Avatar, GroupAvatar, Button, Muted, Dialog, ProfileSkeleton, Section, Divider, IconButton, TextField } from '../components/ui';
import { fullName } from '../utils/chatFormat';

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
  const version = chat.groupVersion[conversationId] || 0;

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
          <GroupAvatar size={112} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: theme.font.xxl, fontWeight: '700', color: c.text, textAlign: 'center', flexShrink: 1 }} testID="group-title">{title}</Text>
            {admin ? <IconButton name="pencil" size={18} color={c.accent} accessibilityLabel="Edit name and description" testID="group-edit"
              onPress={() => { setEditTitle(group.title); setEditDescription(group.description || ''); setEditOpen(true); }} /> : null}
          </View>
          <Muted style={{ fontSize: theme.font.md }}>{isMember ? `Group · ${members.length} member${members.length === 1 ? '' : 's'}` : 'You’re no longer a member'}</Muted>
          {description ? <Text style={{ color: c.text, fontSize: theme.font.md, textAlign: 'center', marginTop: theme.space.xs }} testID="group-description-text">{description}</Text> : null}
          {group ? <Muted>Created by {group.created_by.user_id === chat.myId ? 'you' : group.created_by.name}, {memberSince(group.created_at)}</Muted> : null}
        </View>

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
