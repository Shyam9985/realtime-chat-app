import React, { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { getUserProfile } from '../services/chat.service';
import { Screen, Avatar, Button, Muted, Dialog, ProfileSkeleton, EmptyState, IconButton, Section, Divider, useUserPhoto } from '../components/ui';
import ZoomableImage from '../components/ZoomableImage';
import { fullName, presenceLabel } from '../utils/chatFormat';

const memberSince = (value) => {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

function InfoRow({ icon, label, value, last }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border }}>
      <Ionicons name={icon} size={20} color={c.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: theme.font.md }}>{value}</Text>
        <Muted>{label}</Muted>
      </View>
    </View>
  );
}

/*
 * Another member's profile ("contact info"), opened from the chat header, the chat's ⋮ menu or a
 * conversation's avatar: their photo (tap to enlarge), name, email and when they joined, plus
 * Message (when not already coming from the chat) and block / unblock. Blocking asks first, in the
 * same centred dialog the chat uses.
 */
export default function ContactInfoScreen({ route, navigation }) {
  const { userId, fromChat = false } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading');   // loading | ready | error
  const [error, setError] = useState(null);
  const [viewPhoto, setViewPhoto] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const photo = useUserPhoto(profile?.has_photo ? profile.user_id : null, profile?.profile_photo_url);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setProfile(await getUserProfile(userId));
      setStatus('ready');
    } catch (e) {
      setError(e?.error || e?.message || 'Could not load this profile.');
      setStatus('error');
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const name = fullName(profile);
  const presence = profile?.is_me ? null : presenceLabel(chat.presence[userId] || (profile && { online: profile.online, last_seen_at: profile.last_seen_at }));

  const block = async () => {
    try {
      await chat.blockUser(userId);
      setProfile((p) => ({ ...p, blocked_by_me: true }));
      toast.success(`${name} blocked.`);
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not block.');
    }
  };

  const unblock = async () => {
    try {
      await chat.unblockUser(userId);
      setProfile((p) => ({ ...p, blocked_by_me: false }));
      toast.success(`${name} unblocked.`);
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not unblock.');
    }
  };

  const openChat = async () => {
    try {
      const conversationId = profile.conversation_id || (await chat.startConversation(userId)).conversation_id;
      navigation.navigate('Chat', { conversationId, title: name });
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not open the chat.');
    }
  };

  if (status === 'loading' && !profile) return <Screen><ProfileSkeleton rows={2} /></Screen>;
  if (status === 'error') {
    return <Screen><EmptyState icon="person-circle-outline" title="Profile unavailable" subtitle={error} action={<Button title="Try again" onPress={load} />} /></Screen>;
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }}>
        <View style={{ alignItems: 'center', paddingVertical: theme.space.xl, paddingHorizontal: theme.space.lg, gap: theme.space.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Pressable onPress={() => setViewPhoto(true)} disabled={!photo} accessibilityRole="button" accessibilityLabel={photo ? `View ${name}'s photo` : `${name}'s initials`} testID="contact-photo">
            {photo ? <Image source={{ uri: photo }} style={{ width: 132, height: 132, borderRadius: 66 }} /> : <Avatar user={profile} size={132} showPhoto={false} />}
          </Pressable>
          <Text style={{ fontSize: theme.font.xxl, fontWeight: '700', color: c.text, textAlign: 'center' }} testID="contact-name">{name}</Text>
          {/* "Online" / "last active ...": live when they have a chat with you, else as loaded. none when blocked */}
          {presence ? <Muted style={{ fontSize: theme.font.md }} testID="contact-presence">{presence}</Muted> : null}
          {profile.blocked_by_me ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.space.xs, paddingHorizontal: theme.space.md, paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: c.dangerSoft }}>
              <Ionicons name="ban" size={14} color={c.danger} />
              <Text style={{ color: c.danger, fontSize: theme.font.sm, fontWeight: '600' }}>Blocked</Text>
            </View>
          ) : null}
          {!profile.is_me && !fromChat ? (
            <Button title="Message" icon="chatbubble-ellipses-outline" onPress={openChat} style={{ marginTop: theme.space.md, alignSelf: 'stretch', maxWidth: 320, width: '100%' }} />
          ) : null}
        </View>

        <Section title="About">
          <InfoRow icon="mail-outline" label="Email" value={profile.email} />
          <InfoRow icon="calendar-outline" label="Member since" value={memberSince(profile.member_since)} last />
        </Section>

        {!profile.is_me ? (
          <Section title="Privacy">
            <Pressable onPress={profile.blocked_by_me ? unblock : () => setConfirmBlock(true)} accessibilityRole="button" testID={profile.blocked_by_me ? 'contact-unblock' : 'contact-block'}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 14, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
              <Ionicons name={profile.blocked_by_me ? 'checkmark-circle-outline' : 'ban-outline'} size={20} color={profile.blocked_by_me ? c.accent : c.danger} />
              <Text style={{ fontSize: theme.font.md, fontWeight: '600', color: profile.blocked_by_me ? c.accent : c.danger }}>{profile.blocked_by_me ? `Unblock ${name}` : `Block ${name}`}</Text>
            </Pressable>
            <Divider />
            <Muted style={{ paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, lineHeight: Math.round(theme.font.sm * 1.5) }}>
              {profile.blocked_by_me
                ? 'They cannot send you messages. Unblock to let them message you again.'
                : 'Blocked people cannot send you messages. Your chat history stays.'}
            </Muted>
          </Section>
        ) : null}
      </ScrollView>

      <Dialog visible={confirmBlock} icon="ban" tone="danger" title={`Block ${name}?`}
        message="They will no longer be able to message you. You keep this conversation and can unblock them any time."
        actions={[{ label: 'Cancel' }, { label: 'Block', style: 'destructive', onPress: block, testID: 'confirm-block' }]}
        onClose={() => setConfirmBlock(false)} />

      <Modal visible={viewPhoto} transparent animationType="fade" onRequestClose={() => setViewPhoto(false)}>
        <Pressable onPress={() => setViewPhoto(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: theme.space.xl }}>
          {photo ? <ZoomableImage uri={photo} style={{ width: '100%', maxWidth: 420, aspectRatio: 1, borderRadius: theme.radius.lg }} testID="photo-zoom" /> : null}
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: theme.font.lg, marginTop: theme.space.lg }}>{name}</Text>
          <IconButton name="close" size={26} color="#FFFFFF" onPress={() => setViewPhoto(false)} accessibilityLabel="Close" style={{ position: 'absolute', top: 48, right: 16 }} />
        </Pressable>
      </Modal>
    </Screen>
  );
}
