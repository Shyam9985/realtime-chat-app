import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { Screen, Avatar, GroupAvatar, Divider, EmptyState, Button, KeyboardAvoider } from '../components/ui';
import { MESSAGE_MAX_LENGTH, fullName, isGroup } from '../utils/chatFormat';

const MAX_TARGETS = 10;
const titleOf = (c) => c.title || fullName(c.other_user);

/*
 * "Send to": something shared into YaapZone from another app (a reel link, a page, some text) goes to
 * the chats picked here, with an optional line of your own above it. Each chat gets its own encrypted
 * message, exactly as if typed there. Reached only through the Android share sheet (RootNavigator).
 */
export default function ShareToScreen({ route, navigation }) {
  const { text } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [comment, setComment] = useState('');
  const [picked, setPicked] = useState([]);
  const [sending, setSending] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chat.conversations.filter((x) => x.is_member !== false && (!q || titleOf(x).toLowerCase().includes(q)));
  }, [chat.conversations, query]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id]));
  const body = (comment.trim() ? `${comment.trim()}\n${text.trim()}` : text.trim()).slice(0, MESSAGE_MAX_LENGTH);

  const send = async () => {
    setSending(true);
    const refused = [];
    for (const id of picked) {
      try { await chat.sendMessage(id, body); }
      catch (e) { refused.push({ id, message: e?.error || e?.message || 'refused' }); }
    }
    setSending(false);
    const sent = picked.length - refused.length;
    if (refused.length) {
      const names = refused.map((r) => titleOf(chat.conversations.find((x) => x.conversation_id === r.id) || {})).join(', ');
      if (sent) toast.warning(`Sent to ${sent} chat${sent === 1 ? '' : 's'}. Not sent to ${names}: ${refused[0].message}.`);
      else toast.error(`Not sent: ${refused[0].message}.`);
    } else {
      toast.success(`Sent to ${sent} chat${sent === 1 ? '' : 's'}.`);
    }
    // one chat: open it, so the sender sees it land; several: back to the list
    if (sent === 1 && picked.length === 1) navigation.replace('Chat', { conversationId: picked[0], title: titleOf(chat.conversations.find((x) => x.conversation_id === picked[0]) || {}) });
    else navigation.goBack();
  };

  return (
    <Screen>
      <View style={{ padding: theme.space.md, gap: theme.space.sm, backgroundColor: c.surface }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: theme.space.sm, borderRadius: theme.radius.md, backgroundColor: c.inputBackground }}>
          <Ionicons name="share-social-outline" size={18} color={c.textMuted} />
          <Text numberOfLines={3} style={{ flex: 1, color: c.textMuted, fontSize: theme.font.sm }} testID="share-preview">{text}</Text>
        </View>
        <TextInput value={comment} onChangeText={(t) => setComment(t.slice(0, 500))} placeholder="Add a message (optional)" placeholderTextColor={c.placeholder} multiline maxLength={500}
          style={{ maxHeight: 80, paddingHorizontal: theme.space.md, paddingVertical: 8, borderRadius: theme.radius.md, backgroundColor: c.inputBackground, fontSize: theme.font.md, color: c.text }}
          accessibilityLabel="Add a message" testID="share-comment" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, backgroundColor: c.inputBackground, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.md }}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search chats" placeholderTextColor={c.placeholder} autoCapitalize="none" autoCorrect={false}
            style={[{ flex: 1, paddingVertical: 9, fontSize: theme.font.md, color: c.text }]} accessibilityLabel="Search chats to send to" testID="share-search" />
        </View>
        <Text style={{ color: c.textMuted, fontSize: theme.font.xs }}>{picked.length ? `${picked.length} selected (up to ${MAX_TARGETS})` : `Choose up to ${MAX_TARGETS} chats`}</Text>
      </View>
      <KeyboardAvoider>
        <FlatList
          data={list}
          keyExtractor={(x) => String(x.conversation_id)}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <Divider inset={72} />}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={chat.conversations.length ? 'No chats match' : 'No chats yet'} subtitle={chat.conversations.length ? 'Try another name.' : 'Start a chat first, then share to it.'} />}
          renderItem={({ item }) => {
            const on = picked.includes(item.conversation_id);
            const full = !on && picked.length >= MAX_TARGETS;
            return (
              <Pressable onPress={() => toggle(item.conversation_id)} disabled={full} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={titleOf(item)} testID={`share-target-${item.conversation_id}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 10, backgroundColor: pressed ? c.surfaceAlt : c.surface, opacity: full ? 0.5 : 1 })}>
                {isGroup(item) ? <GroupAvatar size={44} conversationId={item.conversation_id} photoUrl={item.photo_url} /> : <Avatar user={item.other_user} size={44} />}
                <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: theme.font.md, fontWeight: '600' }}>{titleOf(item)}</Text>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? c.accent : c.textMuted} />
              </Pressable>
            );
          }}
        />
        <View style={{ padding: theme.space.md, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border }}>
          <Button title={picked.length ? `Send to ${picked.length}` : 'Send'} icon="send" onPress={send} loading={sending} disabled={!picked.length || !body} testID="share-send" />
        </View>
      </KeyboardAvoider>
    </Screen>
  );
}
