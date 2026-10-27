import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { Screen, Spinner, Banner, IconButton, Button, EmptyState, Avatar, Dialog, PopupMenu, KeyboardAvoider, webNoOutline } from '../components/ui';
import { MessageBubble, DaySeparator } from '../components/MessageBubble';
import { DELETE_WINDOW_MINUTES, MESSAGE_MAX_LENGTH, dayLabel, fullName, fullStamp, isSameDay, minutesSince } from '../utils/chatFormat';
import { StatusTicks } from '../components/MessageBubble';

// one line of message info: the tick, what it means and when it happened
function InfoLine({ status, label, at, theme }) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.sm }}>
      <View style={{ width: 22, alignItems: 'center' }}><StatusTicks status={status} color={c.textMuted} seenColor={c.seen} /></View>
      <Text style={{ flex: 1, color: c.text, fontSize: theme.font.md, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: at ? c.text : c.textMuted, fontSize: theme.font.sm }}>{at || 'Not yet'}</Text>
    </View>
  );
}

// whatsapp-style header: avatar, name and the email underneath; tapping it opens the contact's profile
function HeaderTitle({ user, title, color, onPress }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`View ${title}'s profile`} testID="chat-header"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {user ? <Avatar user={user} size={36} /> : null}
      <View style={{ minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color, fontWeight: '700', fontSize: 17 }}>{title}</Text>
        {user?.email ? <Text numberOfLines={1} style={{ color, opacity: 0.8, fontSize: 12 }}>{user.email}</Text> : null}
      </View>
    </Pressable>
  );
}

/*
 * The chat window, following the web client's pages/chat/ChatWindow.jsx: the ⋮ menu blocks or
 * unblocks, blocking asks for confirmation, a long press on your own message asks before deleting
 * it for everyone (or explains that the 15 minute window has passed), and a failed message can be
 * retried or discarded. Confirmations and alerts are centred dialogs.
 */
export default function ChatScreen({ route, navigation }) {
  const { conversationId, title } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const conversation = chat.conversations.find((x) => x.conversation_id === conversationId);
  const thread = chat.threads[conversationId];
  const other = conversation?.other_user;
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);   // { kind: 'block' } | { kind: 'info', message } | { kind: 'delete', message, allowed } | { kind: 'failed', message }

  useEffect(() => {
    chat.openConversation(conversationId);
    setDraft('');
    setSendError(null);
    return () => chat.closeConversation(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const openProfile = useCallback(() => {
    if (other) navigation.navigate('ContactInfo', { userId: other.user_id, fromChat: true });
  }, [navigation, other]);

  useLayoutEffect(() => {
    const name = conversation ? (conversation.title || fullName(other)) : title;
    navigation.setOptions({
      headerTitle: () => <HeaderTitle user={other} title={name} color={c.headerText} onPress={other ? openProfile : undefined} />,
      headerRight: () => (other ? <IconButton name="ellipsis-vertical" color={c.headerText} onPress={() => setMenuOpen(true)} accessibilityLabel="Conversation options" /> : null),
    });
  }, [navigation, conversation, other, title, c.headerText, openProfile]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setSendError(null);
    try {
      await chat.sendMessage(conversationId, text);
    } catch (error) {
      setSendError(error?.statusKey === 'BLOCKED' ? "You can't send messages to this user." : error?.message || error?.error || 'Message not sent.');
    }
  }, [draft, chat, conversationId]);

  const actionFailed = (e) => setSendError(e?.statusKey === 'DELETE_WINDOW_EXPIRED' ? 'Too late: the 15 minute window has passed.' : e?.error || e?.message || 'Action failed.');

  const onMessageLongPress = (message) => {
    if (message.sender_id !== chat.myId || message.is_deleted || message.local || message.status === 'FAILED') return;
    setConfirm({ kind: 'info', message });
  };

  const onMessagePress = (message) => {
    if (message.status === 'FAILED') setConfirm({ kind: 'failed', message });
  };

  const menuItems = !other ? [] : [
    { label: 'View profile', icon: 'person-circle-outline', onPress: openProfile },
    conversation?.blocked_by_me
      ? { label: 'Unblock user', icon: 'checkmark-circle-outline', onPress: () => chat.unblockUser(other.user_id).catch(actionFailed) }
      : { label: 'Block user', icon: 'ban-outline', destructive: true, onPress: () => setConfirm({ kind: 'block' }) },
  ];

  const dialog = useMemo(() => {
    if (!confirm) return { visible: false };
    if (confirm.kind === 'block') {
      return {
        visible: true, icon: 'ban', tone: 'danger', title: `Block ${fullName(other)}?`,
        message: 'They will no longer be able to message you. You keep this conversation and can unblock them any time.',
        actions: [{ label: 'Cancel' }, { label: 'Block', style: 'destructive', testID: 'confirm-block', onPress: () => chat.blockUser(other.user_id).catch(actionFailed) }],
      };
    }
    if (confirm.kind === 'info') {
      // read the message from the thread each render, so delivered / read times appear live while open
      const m = (thread?.messages || []).find((x) => x.message_id === confirm.message.message_id) || confirm.message;
      const allowed = minutesSince(m.created_at) < DELETE_WINDOW_MINUTES;
      return {
        visible: true, icon: 'information-circle-outline', title: 'Message info',
        children: (
          <View style={{ marginTop: theme.space.md }} testID="message-info">
            <Text numberOfLines={3} style={{ color: c.textMuted, fontSize: theme.font.sm, textAlign: 'center', marginBottom: theme.space.md }}>{m.content}</Text>
            <InfoLine status="SENT" label="Sent" at={fullStamp(m.created_at)} theme={theme} />
            <InfoLine status="DELIVERED" label="Delivered" at={fullStamp(m.delivered_at)} theme={theme} />
            <InfoLine status="SEEN" label="Read" at={fullStamp(m.seen_at)} theme={theme} />
          </View>
        ),
        actions: [
          { label: 'Delete', style: 'destructive', testID: 'info-delete', onPress: () => setConfirm({ kind: 'delete', message: m, allowed }) },
          { label: 'Close', style: 'primary', testID: 'info-close' },
        ],
      };
    }
    if (confirm.kind === 'delete') {
      return confirm.allowed ? {
        visible: true, icon: 'trash-outline', tone: 'danger', title: 'Delete for everyone?',
        message: `The message is replaced by “This message was deleted” for both of you. You can do this for ${DELETE_WINDOW_MINUTES} minutes after sending.`,
        actions: [{ label: 'Cancel' }, { label: 'Delete', style: 'destructive', testID: 'confirm-delete', onPress: () => chat.deleteMessage(confirm.message).catch(actionFailed) }],
      } : {
        visible: true, icon: 'time-outline', title: 'Delete for everyone?',
        message: `Messages older than ${DELETE_WINDOW_MINUTES} minutes can no longer be deleted for everyone.`,
        actions: [{ label: 'OK', style: 'primary' }],
      };
    }
    return {
      visible: true, icon: 'alert-circle-outline', tone: 'danger', title: 'Message not sent',
      message: confirm.message.error || 'The message could not be sent.',
      actions: [
        { label: 'Discard', onPress: () => chat.discardMessage(confirm.message) },
        { label: 'Retry', style: 'primary', onPress: () => chat.retryMessage(confirm.message).catch(() => {}) },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, other, chat, thread, theme]);

  const messages = thread?.messages || [];
  const renderItem = ({ item, index }) => {
    const older = messages[index + 1];
    const showDay = !older || !isSameDay(item.created_at, older.created_at);
    return (
      <View>
        {showDay ? <DaySeparator label={dayLabel(item.created_at)} /> : null}
        <MessageBubble message={item} mine={item.sender_id === chat.myId} onLongPress={() => onMessageLongPress(item)} onPress={() => onMessagePress(item)} />
      </View>
    );
  };

  const remaining = MESSAGE_MAX_LENGTH - draft.length;
  const canSend = !!draft.trim();

  return (
    <Screen background={c.chatBackground}>
      {/* the composer rides on top of the keyboard on both platforms */}
      <KeyboardAvoider>
        {chat.socketStatus !== 'connected' ? <Banner kind="warning" text={chat.socketStatus === 'connecting' ? 'Connecting…' : 'Offline. Sending falls back to the server api.'} /> : null}
        {conversation?.blocked_by_me ? (
          <Banner kind="danger" text={`You blocked ${fullName(other)}. They can't message you.`}
            action={<Button title="Unblock" variant="ghost" onPress={() => chat.unblockUser(other.user_id).catch(actionFailed)} style={{ paddingVertical: 6, paddingHorizontal: 10 }} />} />
        ) : null}

        {/* the message area takes all the height, so the composer stays at the bottom while loading */}
        <View style={{ flex: 1 }}>
        {thread?.status === 'loading' && messages.length === 0 ? (
          <Spinner style={{ marginTop: theme.space.xxl }} />
        ) : thread?.status === 'error' && messages.length === 0 ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load messages" subtitle={thread.error} action={<Button title="Try again" onPress={() => chat.openConversation(conversationId)} />} />
        ) : messages.length === 0 ? (
          <EmptyState icon="hand-left-outline" title={`Say hello to ${fullName(other)}`} subtitle="Messages are delivered in real time and kept for when they are offline." />
        ) : (
          <FlatList
            inverted
            data={messages}
            keyExtractor={(m) => String(m.message_id || m.client_message_id)}
            renderItem={renderItem}
            onEndReached={() => chat.loadOlder(conversationId)}
            onEndReachedThreshold={0.4}
            ListFooterComponent={thread?.status === 'loading' ? <Spinner size="small" style={{ marginVertical: theme.space.md }} /> : null}
            contentContainerStyle={{ paddingVertical: theme.space.md }}
            testID="message-list"
          />
        )}
        </View>

        {sendError ? <Banner kind="danger" text={sendError} action={<IconButton name="close" size={18} color={c.danger} onPress={() => setSendError(null)} accessibilityLabel="Dismiss" />} /> : null}

        {/* composer: pill input and a round send button */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: c.surface, borderRadius: 24, paddingLeft: theme.space.md, paddingRight: theme.space.sm, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 }}>
            <TextInput
              value={draft}
              onChangeText={(t) => setDraft(t.slice(0, MESSAGE_MAX_LENGTH))}
              placeholder="Message"
              placeholderTextColor={c.placeholder}
              multiline
              maxLength={MESSAGE_MAX_LENGTH}
              style={[{ flex: 1, maxHeight: 120, fontSize: theme.font.md, color: c.text, paddingVertical: 8 }, webNoOutline]}
              onKeyPress={Platform.OS === 'web' ? (e) => { if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault(); send(); } } : undefined}
              blurOnSubmit={false}
              testID="composer"
              accessibilityLabel="Message"
            />
            {remaining < 200 ? <Text style={{ alignSelf: 'flex-end', paddingBottom: 10, fontSize: theme.font.xs, color: remaining < 0 ? c.danger : c.textMuted }}>{remaining}</Text> : null}
          </View>
          <IconButton name="send" size={22} color="#FFFFFF" onPress={send} accessibilityLabel="Send"
            style={{ backgroundColor: canSend ? c.accentBright : c.textMuted, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, padding: 0, paddingLeft: 3 }} />
        </View>
      </KeyboardAvoider>

      <PopupMenu visible={menuOpen} items={menuItems} onClose={() => setMenuOpen(false)} />
      <Dialog {...dialog} onClose={() => setConfirm(null)} />
    </Screen>
  );
}
