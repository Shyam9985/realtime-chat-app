import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Avatar, Badge } from './ui';
import { DELETED_PLACEHOLDER, fullName, listStamp } from '../utils/chatFormat';

// the avatar (opens the contact's profile) and the rest of the row (opens the chat) are two sibling
// touch targets: a button inside a button is invalid on the web build and ambiguous for screen readers
export function ConversationRow({ conversation, myId, onPress, onAvatarPress }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const other = conversation.other_user;
  const last = conversation.last_message;
  const unread = conversation.unread_count > 0;
  const preview = !last ? 'Tap to start chatting' : last.is_deleted ? DELETED_PLACEHOLDER : last.content;
  const mine = last && last.sender_id === myId;
  const name = conversation.title || fullName(other);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: c.surface }}>
      <Pressable onPress={onAvatarPress} disabled={!onAvatarPress} accessibilityRole="button" accessibilityLabel={`View ${fullName(other)}'s profile`}
        style={({ pressed }) => ({ justifyContent: 'center', paddingLeft: theme.space.lg, paddingRight: theme.space.md, paddingVertical: 11, backgroundColor: pressed ? c.surfaceAlt : c.surface })}>
        <Avatar user={other} size={52} />
      </Pressable>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open chat with ${fullName(other)}`}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, justifyContent: 'center', paddingRight: theme.space.lg, paddingVertical: 11, backgroundColor: pressed ? c.surfaceAlt : c.surface })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: theme.font.lg, fontWeight: unread ? '700' : '500', color: c.text }}>
            {name}
          </Text>
          <Text style={{ fontSize: theme.font.xs, color: unread ? c.accentBright : c.textMuted, fontWeight: unread ? '700' : '400' }}>{listStamp(conversation.last_message_at)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm, marginTop: 3 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {conversation.blocked_by_me ? <Ionicons name="ban" size={13} color={c.danger} /> : null}
            {mine && !last.is_deleted ? <Ionicons name="checkmark-done" size={15} color={c.textMuted} /> : null}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: theme.font.sm, color: unread ? c.text : c.textMuted, fontStyle: last?.is_deleted ? 'italic' : 'normal' }}>
              {preview}
            </Text>
          </View>
          <Badge count={conversation.unread_count} />
        </View>
      </Pressable>
    </View>
  );
}
