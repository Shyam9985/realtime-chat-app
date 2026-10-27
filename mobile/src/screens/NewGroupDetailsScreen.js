import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { Screen, FormScroll, TextField, Button, Muted, Avatar, GroupAvatar } from '../components/ui';
import { firstName, fullName } from '../utils/chatFormat';

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;

/*
 * New group, step 2: the name (required, the same for everyone) and an optional description. You
 * become the group's first admin. People who cannot be added (they blocked you, or left YaapZone) are
 * reported; the group is created with the others.
 */
export default function NewGroupDetailsScreen({ route, navigation }) {
  const { members } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!title.trim()) { setError('Give the group a name.'); return; }
    setCreating(true);
    try {
      const { conversation, skipped } = await chat.createGroup(title.trim(), description.trim(), members.map((m) => m.user_id));
      if (skipped?.length) {
        const names = members.filter((m) => skipped.includes(m.user_id)).map((m) => fullName(m)).join(', ');
        toast.warning(`Couldn’t add ${names}.`);
      }
      // the chat replaces the whole "new group" flow: back goes to the chat list
      navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Chat', params: { conversationId: conversation.conversation_id, title: conversation.title } }] });
    } catch (e) {
      setError(e?.error || e?.message || 'Could not create the group.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen>
      <FormScroll contentContainerStyle={{ padding: theme.space.lg, paddingBottom: theme.space.xxl }}>
        <View style={{ alignItems: 'center', marginBottom: theme.space.xl }}>
          <GroupAvatar size={88} />
        </View>
        <TextField label="Group name" icon="people-outline" value={title} onChangeText={(t) => { setTitle(t.slice(0, MAX_TITLE)); setError(null); }} error={error}
          placeholder="For example: Goa Trip" autoFocus testID="group-name" right={<Text style={{ color: c.textMuted, fontSize: theme.font.xs, marginRight: 12 }}>{MAX_TITLE - title.length}</Text>} />
        <TextField label="Description (optional)" icon="document-text-outline" value={description} onChangeText={(t) => setDescription(t.slice(0, MAX_DESCRIPTION))}
          placeholder="What is this group about?" multiline testID="group-description" />
        <Muted style={{ marginBottom: theme.space.sm }}>{members.length + 1} members: you and {members.length === 1 ? fullName(members[0]) : `${members.length} others`}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginBottom: theme.space.xl }}>
          {members.map((m) => (
            <View key={m.user_id} style={{ alignItems: 'center', width: 64 }}>
              <Avatar user={m} size={44} />
              <Text numberOfLines={1} style={{ color: c.text, fontSize: theme.font.xs, marginTop: 4 }}>{firstName(fullName(m))}</Text>
            </View>
          ))}
        </View>
        <Muted style={{ marginBottom: theme.space.lg }}>You’ll be the group’s admin: only admins add or remove people and change the name. Anyone can exit the group.</Muted>
        <Button title={creating ? 'Creating…' : 'Create group'} icon="checkmark" onPress={create} loading={creating} testID="group-create" />
      </FormScroll>
    </Screen>
  );
}
