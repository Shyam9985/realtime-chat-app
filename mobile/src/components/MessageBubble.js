import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Platform, Pressable, Text, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { timeOf, DELETED_PLACEHOLDER } from '../utils/chatFormat';

// SRS: sent = one tick, delivered = two, seen = two in colour. sending shows a clock, failed a warning
export function StatusTicks({ status, color, seenColor }) {
  if (status === 'SENDING') return <Ionicons name="time-outline" size={13} color={color} accessibilityLabel="Sending" />;
  if (status === 'FAILED') return <Ionicons name="alert-circle" size={14} color="#F15C6D" accessibilityLabel="Not sent" />;
  if (status === 'SENT') return <Ionicons name="checkmark" size={15} color={color} accessibilityLabel="Sent" />;
  if (status === 'DELIVERED') return <Ionicons name="checkmark-done" size={15} color={color} accessibilityLabel="Delivered" />;
  if (status === 'SEEN') return <Ionicons name="checkmark-done" size={15} color={seenColor} accessibilityLabel="Seen" />;
  return null;
}

// the text with every match of `highlight` marked (case-insensitive), for in-chat search
function Highlighted({ text, highlight, style, markColor }) {
  if (!highlight || !text) return <Text selectable={false} style={style}>{text}</Text>;
  const lower = text.toLowerCase();
  const needle = highlight.toLowerCase();
  const parts = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<Text key={at} style={{ backgroundColor: markColor, fontWeight: '700' }}>{text.slice(at, at + needle.length)}</Text>);
    from = at + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <Text selectable={false} style={style}>{parts}</Text>;
}

// the quoted message inside a reply; tapping it jumps to the original
export function ReplyQuote({ reply, authorName, onPress, compact, style }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const deleted = reply.is_deleted || reply.content == null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`Reply to ${authorName}: ${deleted ? DELETED_PLACEHOLDER : reply.content}`} testID="reply-quote"
      style={[{ borderLeftWidth: 4, borderLeftColor: c.accent, backgroundColor: c.overlaySoft || 'rgba(0,0,0,0.06)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }, style]}>
      <Text numberOfLines={1} style={{ color: c.accent, fontWeight: '700', fontSize: theme.font.sm }}>{authorName}</Text>
      <Text numberOfLines={compact ? 1 : 2} style={{ color: c.textMuted, fontSize: theme.font.sm, fontStyle: deleted ? 'italic' : 'normal' }}>{deleted ? DELETED_PLACEHOLDER : reply.content}</Text>
    </Pressable>
  );
}

const SWIPE_TRIGGER = 64;

/*
 * One message. Long press selects it (reply / forward / edit / info / delete in the header); swiping
 * it to the right quotes it in the composer; tapping a failed one offers retry. Swipe only reacts to
 * a clearly horizontal drag, so scrolling the chat never starts a reply by accident.
 */
export function MessageBubble({ message, mine, onLongPress, onPress, onReply, onQuotePress, quoteAuthor, highlight, selected, focused }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const deleted = message.is_deleted;
  const failed = message.status === 'FAILED';
  const bg = mine ? c.bubbleMine : c.bubbleTheirs;
  const fg = mine ? c.bubbleMineText : c.bubbleTheirsText;
  const meta = mine ? c.bubbleMineMeta : c.textMuted;
  const canReply = !!onReply && !deleted && !failed && !message.local;

  const dx = useRef(new Animated.Value(0)).current;
  const triggered = useRef(false);
  const responder = useMemo(() => PanResponder.create({
    // capture phase: the bubble's own press handler already owns the touch, so the swipe has to claim a
    // clearly horizontal drag before it; taps, long presses and vertical scrolling are left alone
    onMoveShouldSetPanResponderCapture: (_, g) => canReply && g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      const x = Math.max(0, Math.min(g.dx, SWIPE_TRIGGER * 1.4));
      dx.setValue(x);
      if (!triggered.current && x >= SWIPE_TRIGGER) { triggered.current = true; if (Platform.OS !== 'web') Vibration.vibrate(15); }
    },
    onPanResponderRelease: () => {
      if (triggered.current) onReply(message);
      triggered.current = false;
      Animated.spring(dx, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 6 }).start();
    },
    onPanResponderTerminate: () => { triggered.current = false; Animated.spring(dx, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start(); },
  }), [canReply, onReply, message, dx]);

  const replyIconOpacity = dx.interpolate({ inputRange: [0, SWIPE_TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <View style={{ backgroundColor: selected ? c.selection || 'rgba(37,211,102,0.18)' : 'transparent', paddingVertical: 1 }}>
      <Animated.View style={{ position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center', opacity: replyIconOpacity }} pointerEvents="none">
        <Ionicons name="arrow-undo" size={20} color={c.textMuted} />
      </Animated.View>
      <Animated.View {...responder.panHandlers} style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', paddingHorizontal: theme.space.md, marginVertical: 2, transform: [{ translateX: dx }] }}>
        <Pressable
          onLongPress={onLongPress}
          onPress={onPress}
          delayLongPress={300}
          accessibilityLabel={deleted ? DELETED_PLACEHOLDER : message.content}
          accessibilityHint={canReply ? 'Long press for options, swipe right to reply' : undefined}
          accessibilityState={{ selected: !!selected }}
          testID={`bubble-${message.message_id || message.client_message_id}`}
          style={({ pressed }) => ({
            maxWidth: '80%',
            backgroundColor: bg,
            borderRadius: 10,
            borderTopRightRadius: mine ? 2 : 10,
            borderTopLeftRadius: mine ? 10 : 2,
            paddingHorizontal: 10,
            paddingTop: 6,
            paddingBottom: 5,
            borderWidth: focused ? 2 : 0,
            borderColor: c.accent,
            shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1,
            opacity: pressed ? 0.85 : failed ? 0.8 : 1,
          })}
        >
          {message.is_forwarded && !deleted ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Ionicons name="arrow-redo" size={12} color={meta} />
              <Text style={{ color: meta, fontStyle: 'italic', fontSize: theme.font.xs }}>Forwarded</Text>
            </View>
          ) : null}
          {message.reply_to && !deleted ? (
            <ReplyQuote reply={message.reply_to} authorName={quoteAuthor ? quoteAuthor(message.reply_to.sender_id) : ''} onPress={onQuotePress ? () => onQuotePress(message.reply_to.message_id) : undefined} style={{ marginBottom: 4 }} />
          ) : null}
          {deleted ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ban-outline" size={14} color={meta} />
              <Text style={{ color: meta, fontStyle: 'italic', fontSize: theme.font.md }}>{DELETED_PLACEHOLDER}</Text>
            </View>
          ) : (
            <Highlighted text={message.content} highlight={highlight} markColor={c.highlight || 'rgba(255,214,10,0.55)'} style={{ color: fg, fontSize: theme.font.md, lineHeight: Math.round(theme.font.md * 1.4) }} />
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
            {failed ? <Text style={{ color: '#F15C6D', fontSize: theme.font.xs }}>{message.error || 'Not sent'} · tap to retry</Text> : null}
            {message.is_edited && !deleted ? <Text style={{ color: meta, fontSize: theme.font.xs, fontStyle: 'italic' }} testID="edited-label">Edited</Text> : null}
            <Text style={{ color: meta, fontSize: theme.font.xs }}>{timeOf(message.created_at)}</Text>
            {mine && !deleted ? <StatusTicks status={message.status} color={meta} seenColor={c.seen} /> : null}
          </View>
        </Pressable>
      </Animated.View>
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
