import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { Screen, Avatar, GroupAvatar, Divider, EmptyState, Button, KeyboardAvoider, webNoOutline } from '../components/ui';
import { fullName, isGroup } from '../utils/chatFormat';

const MAX_TARGETS = 10;
const titleOf = (c) => c.title || fullName(c.other_user);

/*
 * Pick the chats to forward a message to (up to 10). Each chosen chat gets its own copy marked
 * "Forwarded"; a refused one (for example, the other person blocked you) is reported and the rest
 * still go out.
 */
export default function ForwardScreen({ route, navigation }) {
  const { message } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);
  const [sending, setSending] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // a group you exited can no longer be written to
    return chat.conversations.filter((x) => x.is_member !== false && (!q || titleOf(x).toLowerCase().includes(q)));
  }, [chat.conversations, query]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id]));

  const send = async () => {
    setSending(true);
    try {
      const { results, sent } = await chat.forwardMessage(message, picked);
      const refused = results.filter((r) => !r.ok);
      if (refused.length) {
        const names = refused.map((r) => titleOf(chat.conversations.find((x) => x.conversation_id === r.conversation_id) || {})).join(', ');
        if (sent) toast.warning(`Forwarded to ${sent} chat${sent === 1 ? '' : 's'}. Not sent to ${names}: ${refused[0].error?.message || 'refused'}.`);
        else toast.error(`Not forwarded: ${refused[0].error?.message || 'refused'}.`);
      } else {
        toast.success(`Forwarded to ${sent} chat${sent === 1 ? '' : 's'}.`);
      }
      navigation.goBack();
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not forward the message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <View style={{ padding: theme.space.md, gap: theme.space.sm, backgroundColor: c.surface }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: theme.space.sm, borderRadius: theme.radius.md, backgroundColor: c.inputBackground }}>
          <Ionicons name="arrow-redo-outline" size={18} color={c.textMuted} />
          <Text numberOfLines={2} style={{ flex: 1, color: c.textMuted, fontSize: theme.font.sm }} testID="forward-preview">{message.content}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, backgroundColor: c.inputBackground, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.md }}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search chats" placeholderTextColor={c.placeholder} autoCapitalize="none" autoCorrect={false}
            style={[{ flex: 1, paddingVertical: 9, fontSize: theme.font.md, color: c.text }, webNoOutline]} accessibilityLabel="Search chats to forward to" testID="forward-search" />
        </View>
        <Text style={{ color: c.textMuted, fontSize: theme.font.xs }}>{picked.length ? `${picked.length} selected (up to ${MAX_TARGETS})` : `Choose up to ${MAX_TARGETS} chats`}</Text>
      </View>
      <KeyboardAvoider>
        <FlatList
          data={list}
          keyExtractor={(x) => String(x.conversation_id)}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <Divider inset={72} />}
          ListEmptyComponent={<EmptyState icon="search-outline" title="No chats match" subtitle="Try another name." />}
          renderItem={({ item }) => {
            const on = picked.includes(item.conversation_id);
            const full = !on && picked.length >= MAX_TARGETS;
            return (
              <Pressable onPress={() => toggle(item.conversation_id)} disabled={full} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={titleOf(item)} testID={`forward-target-${item.conversation_id}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 10, backgroundColor: pressed ? c.surfaceAlt : c.surface, opacity: full ? 0.5 : 1 })}>
                {isGroup(item) ? <GroupAvatar size={44} /> : <Avatar user={item.other_user} size={44} />}
                <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: theme.font.md, fontWeight: '600' }}>{titleOf(item)}</Text>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? c.accent : c.textMuted} />
              </Pressable>
            );
          }}
        />
        <View style={{ padding: theme.space.md, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border }}>
          <Button title={picked.length ? `Forward to ${picked.length}` : 'Forward'} icon="arrow-redo" onPress={send} loading={sending} disabled={!picked.length} testID="forward-send" />
        </View>
      </KeyboardAvoider>
    </Screen>
  );
}
