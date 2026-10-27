import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Avatar, Badge, GroupAvatar } from './ui';
import { StatusTicks } from './MessageBubble';
import { DELETED_PLACEHOLDER, firstName, fullName, isGroup, isNotice, listStamp, noticeText } from '../utils/chatFormat';

// the last message as the list shows it: a notice in words; in a group, who wrote it ("Noah: ...")
const previewOf = (conversation, myId) => {
  const last = conversation.last_message;
  if (!last) return 'Tap to start chatting';
  if (isNotice(last)) return noticeText(last, myId);
  const text = last.is_deleted ? DELETED_PLACEHOLDER : last.content;
  if (!isGroup(conversation)) return text;
  return `${last.sender_id === myId ? 'You' : firstName(last.sender_name)}: ${text}`;
};

// the avatar (opens the contact's profile, or the group's info) and the rest of the row (opens the chat)
// are two sibling touch targets: a button inside a button is invalid on the web build and ambiguous for
// screen readers
export function ConversationRow({ conversation, myId, onPress, onAvatarPress, onLongPress }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const group = isGroup(conversation);
  const other = conversation.other_user;
  const last = conversation.last_message;
  const unread = conversation.unread_count > 0;
  const mine = last && last.sender_id === myId && !isNotice(last);
  const name = conversation.title || fullName(other);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: c.surface }}>
      <Pressable onPress={onAvatarPress} onLongPress={onLongPress} delayLongPress={350} disabled={!onAvatarPress} accessibilityRole="button"
        accessibilityLabel={group ? `${name} group info` : `View ${fullName(other)}'s profile`}
        style={({ pressed }) => ({ justifyContent: 'center', paddingLeft: theme.space.lg, paddingRight: theme.space.md, paddingVertical: 11, backgroundColor: pressed ? c.surfaceAlt : c.surface })}>
        {group ? <GroupAvatar size={52} /> : <Avatar user={other} size={52} />}
      </Pressable>
      <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} accessibilityRole="button" accessibilityHint="Long press for pin and archive"
        accessibilityLabel={`Open ${group ? 'group' : 'chat with'} ${name}${conversation.is_pinned ? ', pinned' : ''}`} testID={`chat-row-${conversation.conversation_id}`}
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
            {/* the same ticks as the chat window: one when sent, two when delivered, coloured when seen */}
            {mine && !last.is_deleted ? <StatusTicks status={last.status || 'SENT'} color={c.textMuted} seenColor={c.seen} /> : null}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: theme.font.sm, color: unread ? c.text : c.textMuted, fontStyle: last?.is_deleted || isNotice(last) ? 'italic' : 'normal' }}>
              {previewOf(conversation, myId)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {conversation.is_pinned ? <Ionicons name="pin" size={15} color={c.textMuted} accessibilityLabel="Pinned" testID="pinned-icon" /> : null}
            <Badge count={conversation.unread_count} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}
