import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { timeOf, DELETED_PLACEHOLDER } from '../utils/chatFormat';

// SRS: sent = one tick, delivered = two, seen = two in colour. sending shows a clock, failed a warning
export function StatusTicks({ status, color, seenColor }) {
  if (status === 'SENDING') return <Ionicons name="time-outline" size={13} color={color} />;
  if (status === 'FAILED') return <Ionicons name="alert-circle" size={14} color="#F15C6D" />;
  if (status === 'SENT') return <Ionicons name="checkmark" size={15} color={color} />;
  if (status === 'DELIVERED') return <Ionicons name="checkmark-done" size={15} color={color} />;
  if (status === 'SEEN') return <Ionicons name="checkmark-done" size={15} color={seenColor} />;
  return null;
}

export function MessageBubble({ message, mine, onLongPress, onPress }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const deleted = message.is_deleted;
  const failed = message.status === 'FAILED';
  const bg = mine ? c.bubbleMine : c.bubbleTheirs;
  const fg = mine ? c.bubbleMineText : c.bubbleTheirsText;
  const meta = mine ? c.bubbleMineMeta : c.textMuted;

  return (
    <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', paddingHorizontal: theme.space.md, marginVertical: 2 }}>
      <Pressable
        onLongPress={onLongPress}
        onPress={onPress}
        delayLongPress={300}
        accessibilityLabel={deleted ? DELETED_PLACEHOLDER : message.content}
        style={({ pressed }) => ({
          maxWidth: '80%',
          backgroundColor: bg,
          borderRadius: 10,
          borderTopRightRadius: mine ? 2 : 10,
          borderTopLeftRadius: mine ? 10 : 2,
          paddingHorizontal: 10,
          paddingTop: 6,
          paddingBottom: 5,
          shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1,
          opacity: pressed ? 0.85 : failed ? 0.8 : 1,
        })}
      >
        {deleted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="ban-outline" size={14} color={meta} />
            <Text style={{ color: meta, fontStyle: 'italic', fontSize: theme.font.md }}>{DELETED_PLACEHOLDER}</Text>
          </View>
        ) : (
          <Text style={{ color: fg, fontSize: theme.font.md, lineHeight: 21 }}>{message.content}</Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
          {failed ? <Text style={{ color: '#F15C6D', fontSize: theme.font.xs }}>{message.error || 'Not sent'} · tap to retry</Text> : null}
          <Text style={{ color: meta, fontSize: theme.font.xs }}>{timeOf(message.created_at)}</Text>
          {mine && !deleted ? <StatusTicks status={message.status} color={meta} seenColor={c.seen} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

export function DaySeparator({ label }) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: theme.space.md }}>
      <View style={{ backgroundColor: theme.colors.surface, paddingHorizontal: theme.space.md, paddingVertical: 5, borderRadius: theme.radius.sm, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.font.xs, fontWeight: '600' }}>{label}</Text>
      </View>
    </View>
  );
}
