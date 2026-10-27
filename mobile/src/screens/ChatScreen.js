import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import * as chatApi from '../services/chat.service';
import { Screen, Banner, IconButton, Button, EmptyState, Avatar, Dialog, PopupMenu, KeyboardAvoider, ChatSkeleton, TextField, webNoOutline } from '../components/ui';
import { MessageBubble, DaySeparator, StatusTicks, ReplyQuote } from '../components/MessageBubble';
import ScheduleDialog from '../components/ScheduleDialog';
import { exportChatAsPdf } from '../utils/exportChat';
import { DELETE_WINDOW_MINUTES, MESSAGE_MAX_LENGTH, dayLabel, fullName, fullStamp, isSameDay, minutesSince, timeOf } from '../utils/chatFormat';

const EDIT_WINDOW_MINUTES = 15;

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

const headerIcon = (name, onPress, label, color, testID) => (
  <IconButton key={name} name={name} color={color} onPress={onPress} accessibilityLabel={label} style={{ marginHorizontal: 2 }} testID={testID} />
);

/*
 * The chat window. Long press a message to select it: the header then offers reply, forward, edit
 * (own message, 15 minutes), info and delete. Swipe a message right to reply. The search icon finds
 * text anywhere in the chat; the ⋮ menu renames the chat (for you only), exports it as a PDF, and
 * blocks or unblocks. Hold the send button to schedule the message for a date and time.
 */
export default function ChatScreen({ route, navigation }) {
  const { conversationId, title } = route.params;
  const { theme } = useTheme();
  const c = theme.colors;
  const chat = useChat();
  const toast = useToast();
  const conversation = chat.conversations.find((x) => x.conversation_id === conversationId);
  const thread = chat.threads[conversationId];
  const other = conversation?.other_user;
  const name = conversation ? (conversation.title || fullName(other)) : title;
  const messages = useMemo(() => thread?.messages || [], [thread]);
  const listRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);       // { kind: 'block' | 'delete' | 'failed' | 'info', message }
  const [selected, setSelected] = useState(null);     // the long-pressed message
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);       // { kind: 'message', message } | { kind: 'scheduled', item }
  const [history, setHistory] = useState(null);       // earlier versions shown in message info
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState(null);       // null = not searched yet
  const [resultIndex, setResultIndex] = useState(0);
  const [focusedId, setFocusedId] = useState(null);
  const [scheduleFor, setScheduleFor] = useState(null); // { content, initial, item? } while the dialog is open
  const [scheduled, setScheduled] = useState([]);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [exporting, setExporting] = useState(null);   // null | number of messages fetched so far

  useEffect(() => {
    chat.openConversation(conversationId);
    setDraft(''); setSendError(null); setReplyTo(null); setEditing(null); setSelected(null);
    return () => chat.closeConversation(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // the sender's scheduled messages for this chat; refetched whenever the server says they changed
  const scheduledVersion = chat.scheduledVersion[conversationId] || 0;
  useEffect(() => {
    let alive = true;
    chatApi.listScheduled(conversationId).then((list) => { if (alive) setScheduled(list); }).catch(() => {});
    return () => { alive = false; };
  }, [conversationId, scheduledVersion]);

  const openProfile = useCallback(() => { if (other) navigation.navigate('ContactInfo', { userId: other.user_id, fromChat: true }); }, [navigation, other]);
  const authorName = useCallback((senderId) => (senderId === chat.myId ? 'You' : fullName(other)), [chat.myId, other]);
  const isMine = (m) => m.sender_id === chat.myId;
  const canEdit = (m) => isMine(m) && !m.is_deleted && !m.local && m.status !== 'FAILED' && minutesSince(m.created_at) < EDIT_WINDOW_MINUTES;

  // ---- jump to a message (search result, reply quote): load older pages if needed, then scroll
  const jumpTo = useCallback(async (messageId) => {
    const found = await chat.ensureMessageLoaded(conversationId, messageId);
    if (!found) { toast.info('That message is no longer available.'); return; }
    setFocusedId(messageId);
    setTimeout(() => {
      const index = messagesRef.current.findIndex((m) => m.message_id === messageId);
      if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }, 60);
    setTimeout(() => setFocusedId((id) => (id === messageId ? null : id)), 2500);
  }, [chat, conversationId, toast]);

  // ---- search: debounced, server-side, newest match first
  useEffect(() => {
    if (!searchMode) return undefined;
    const q = searchQuery.trim();
    if (!q) { setResults(null); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const found = await chatApi.searchMessages(conversationId, q);
        setResults(found);
        setResultIndex(0);
        if (found.length) jumpTo(found[0].message_id);
      } catch (e) {
        toast.error(e?.error || e?.message || 'Search failed.');
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchMode, conversationId]);

  const stepResult = (delta) => {
    if (!results?.length) return;
    const next = Math.min(results.length - 1, Math.max(0, resultIndex + delta));
    setResultIndex(next);
    jumpTo(results[next].message_id);
  };
  const closeSearch = () => { setSearchMode(false); setSearchQuery(''); setResults(null); setFocusedId(null); };

  // ---- header: selection actions, search field, or the normal title with search and menu
  useLayoutEffect(() => {
    const color = c.headerText;
    if (selected) {
      const m = selected;
      navigation.setOptions({
        headerLeft: () => headerIcon('close', () => setSelected(null), 'Clear selection', color, 'selection-clear'),
        headerTitle: () => <Text style={{ color, fontWeight: '700', fontSize: 17 }}>1 selected</Text>,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }} testID="selection-actions">
            {!m.is_deleted ? headerIcon('arrow-undo-outline', () => { setReplyTo(m); setEditing(null); setSelected(null); }, 'Reply', color, 'action-reply') : null}
            {!m.is_deleted ? headerIcon('arrow-redo-outline', () => { setSelected(null); navigation.navigate('Forward', { message: m }); }, 'Forward', color, 'action-forward') : null}
            {canEdit(m) ? headerIcon('create-outline', () => { setEditing({ kind: 'message', message: m }); setReplyTo(null); setDraft(m.content); setSelected(null); }, 'Edit', color, 'action-edit') : null}
            {isMine(m) ? headerIcon('information-circle-outline', () => { setConfirm({ kind: 'info', message: m }); setSelected(null); }, 'Message info', color, 'action-info') : null}
            {isMine(m) && !m.is_deleted ? headerIcon('trash-outline', () => { setConfirm({ kind: 'delete', message: m, allowed: minutesSince(m.created_at) < DELETE_WINDOW_MINUTES }); setSelected(null); }, 'Delete', color, 'action-delete') : null}
          </View>
        ),
      });
    } else if (searchMode) {
      navigation.setOptions({
        headerLeft: () => headerIcon('arrow-back', closeSearch, 'Close search', color, 'search-close'),
        headerTitle: () => (
          <TextInput value={searchQuery} onChangeText={setSearchQuery} autoFocus placeholder="Search this chat" placeholderTextColor={color}
            style={[{ color, fontSize: 16, minWidth: 140, paddingVertical: 6 }, webNoOutline]} accessibilityLabel="Search this chat" testID="chat-search-input" />
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color, opacity: 0.85, fontSize: 13, marginRight: 4 }} testID="search-count">
              {results == null ? '' : results.length ? `${resultIndex + 1} of ${results.length}` : 'No results'}
            </Text>
            {headerIcon('chevron-up', () => stepResult(1), 'Older match', color, 'search-older')}
            {headerIcon('chevron-down', () => stepResult(-1), 'Newer match', color, 'search-newer')}
          </View>
        ),
      });
    } else {
      navigation.setOptions({
        headerLeft: undefined,
        headerTitle: () => <HeaderTitle user={other} title={name} color={color} onPress={other ? openProfile : undefined} />,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {headerIcon('search-outline', () => setSearchMode(true), 'Search this chat', color, 'chat-search-open')}
            {other ? headerIcon('ellipsis-vertical', () => setMenuOpen(true), 'Conversation options', color, 'chat-menu') : null}
          </View>
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, selected, searchMode, searchQuery, results, resultIndex, other, name, c.headerText, openProfile]);

  // ---- sending, editing, scheduling
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setSendError(null);
    if (editing?.kind === 'message') {
      try {
        await chat.editMessage(editing.message, text);
        setEditing(null); setDraft('');
      } catch (e) {
        setSendError(e?.statusKey === 'EDIT_WINDOW_EXPIRED' ? 'Too late: messages can only be edited for 15 minutes.' : e?.error || e?.message || 'Could not edit the message.');
      }
      return;
    }
    if (editing?.kind === 'scheduled') {
      setScheduleFor({ content: text, initial: new Date(editing.item.send_at), item: editing.item });
      return;
    }
    const quoted = replyTo;
    setDraft(''); setReplyTo(null);
    try {
      await chat.sendMessage(conversationId, text, quoted);
    } catch (error) {
      setSendError(error?.statusKey === 'BLOCKED' ? "You can't send messages to this user." : error?.message || error?.error || 'Message not sent.');
    }
  }, [draft, editing, replyTo, chat, conversationId]);

  const openScheduleForDraft = () => {
    if (editing?.kind === 'message') return;
    if (!draft.trim()) { toast.info('Type a message first, then hold send to schedule it.'); return; }
    setScheduleFor({ content: draft.trim(), initial: null, item: editing?.kind === 'scheduled' ? editing.item : null });
  };

  const confirmSchedule = async (when) => {
    const { content, item } = scheduleFor;
    setScheduleFor(null);
    try {
      if (item) await chatApi.updateScheduled(item.scheduled_message_id, { content, send_at: when.toISOString() });
      else await chatApi.scheduleMessage(conversationId, content, when.toISOString(), replyTo?.message_id || null);
      setDraft(''); setEditing(null); setReplyTo(null); setScheduledOpen(true);
      toast.success(`Scheduled for ${dayLabel(when)}, ${timeOf(when)}.`);
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not schedule the message.');
    }
  };

  const cancelScheduled = async (item) => {
    try { await chatApi.cancelScheduled(item.scheduled_message_id); toast.success(item.status === 'FAILED' ? 'Removed.' : 'Scheduled message cancelled.'); }
    catch (e) { toast.error(e?.error || e?.message || 'Could not cancel it.'); }
  };

  const actionFailed = (e) => setSendError(e?.statusKey === 'DELETE_WINDOW_EXPIRED' ? 'Too late: the 15 minute window has passed.' : e?.error || e?.message || 'Action failed.');

  // message info: fetch earlier versions of an edited message when it opens
  useEffect(() => {
    setHistory(null);
    if (confirm?.kind === 'info' && confirm.message.is_edited) {
      chatApi.getEditHistory(confirm.message.message_id).then(setHistory).catch(() => setHistory([]));
    }
  }, [confirm]);

  const rename = async () => {
    try {
      await chat.updateConversationSettings(conversationId, { custom_title: renameText });
      setRenameOpen(false);
      toast.success(renameText.trim() ? 'Chat renamed.' : 'Name reset.');
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not rename the chat.');
    }
  };

  const exportPdf = async () => {
    setExporting(0);
    try {
      const { count } = await exportChatAsPdf({ conversationId, title: name, myId: chat.myId, nameOf: authorName, onProgress: setExporting });
      toast.success(`Exported ${count} message${count === 1 ? '' : 's'}.`);
    } catch (e) {
      toast.error(e?.message || 'Could not export the chat.');
    } finally {
      setExporting(null);
    }
  };

  const menuItems = !other ? [] : [
    { label: 'View profile', icon: 'person-circle-outline', onPress: openProfile },
    { label: 'Rename chat', icon: 'pencil-outline', onPress: () => { setRenameText(conversation?.title || ''); setRenameOpen(true); } },
    { label: 'Export chat', icon: 'document-text-outline', onPress: exportPdf },
    conversation?.blocked_by_me
      ? { label: 'Unblock user', icon: 'checkmark-circle-outline', onPress: () => chat.unblockUser(other.user_id).catch(actionFailed) }
      : { label: 'Block user', icon: 'ban-outline', destructive: true, onPress: () => setConfirm({ kind: 'block' }) },
  ];

  const dialog = (() => {
    if (!confirm) return { visible: false };
    if (confirm.kind === 'block') {
      return {
        visible: true, icon: 'ban', tone: 'danger', title: `Block ${fullName(other)}?`,
        message: 'They will no longer be able to message you. You keep this conversation and can unblock them any time.',
        actions: [{ label: 'Cancel' }, { label: 'Block', style: 'destructive', testID: 'confirm-block', onPress: () => chat.blockUser(other.user_id).catch(actionFailed) }],
      };
    }
    if (confirm.kind === 'info') {
      // read live from the thread, so delivered / read times appear while the dialog is open
      const m = messages.find((x) => x.message_id === confirm.message.message_id) || confirm.message;
      return {
        visible: true, icon: 'information-circle-outline', title: 'Message info',
        children: (
          <View style={{ marginTop: theme.space.md }} testID="message-info">
            <Text numberOfLines={3} style={{ color: c.textMuted, fontSize: theme.font.sm, textAlign: 'center', marginBottom: theme.space.md }}>{m.content}</Text>
            <InfoLine status="SENT" label="Sent" at={fullStamp(m.created_at)} theme={theme} />
            <InfoLine status="DELIVERED" label="Delivered" at={fullStamp(m.delivered_at)} theme={theme} />
            <InfoLine status="SEEN" label="Read" at={fullStamp(m.seen_at)} theme={theme} />
            {m.is_edited ? (
              <View style={{ marginTop: theme.space.md }} testID="edit-history">
                <Text style={{ color: c.text, fontWeight: '700', fontSize: theme.font.sm, marginBottom: 4 }}>Edited {fullStamp(m.edited_at)}</Text>
                {history == null ? <ActivityIndicator size="small" color={c.accent} /> : history.filter((v) => !v.current).map((v, i) => (
                  <Text key={i} style={{ color: c.textMuted, fontSize: theme.font.sm, marginTop: 2 }}>{fullStamp(v.from)}: {v.content}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ),
        actions: [{ label: 'Close', style: 'primary', testID: 'info-close' }],
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
  })();

  const highlight = searchMode ? searchQuery.trim() : '';
  const renderItem = ({ item, index }) => {
    const older = messages[index + 1];
    const showDay = !older || !isSameDay(item.created_at, older.created_at);
    return (
      <View>
        {showDay ? <DaySeparator label={dayLabel(item.created_at)} /> : null}
        <MessageBubble message={item} mine={isMine(item)} highlight={highlight} focused={focusedId === item.message_id}
          selected={selected && ((selected.message_id && selected.message_id === item.message_id) || (selected.client_message_id && selected.client_message_id === item.client_message_id))}
          onLongPress={() => { if (!item.local && item.status !== 'FAILED') setSelected(item); }}
          onPress={() => { if (selected) setSelected(null); else if (item.status === 'FAILED') setConfirm({ kind: 'failed', message: item }); }}
          onReply={(m) => { setReplyTo(m); setEditing(null); }}
          onQuotePress={jumpTo} quoteAuthor={authorName} />
      </View>
    );
  };

  const remaining = MESSAGE_MAX_LENGTH - draft.length;
  const canSend = !!draft.trim();
  const pending = scheduled.filter((s) => s.status !== 'CANCELLED');

  return (
    <Screen background={c.chatBackground}>
      {/* the composer rides on top of the keyboard on both platforms */}
      <KeyboardAvoider>
        {chat.socketStatus !== 'connected' ? <Banner kind="warning" text={chat.socketStatus === 'connecting' ? 'Connecting…' : 'Offline. Sending falls back to the server api.'} /> : null}
        {conversation?.blocked_by_me ? (
          <Banner kind="danger" text={`You blocked ${fullName(other)}. They can't message you.`}
            action={<Button title="Unblock" variant="ghost" onPress={() => chat.unblockUser(other.user_id).catch(actionFailed)} style={{ paddingVertical: 6, paddingHorizontal: 10 }} />} />
        ) : null}
        {exporting != null ? <Banner kind="info" text={`Preparing the PDF… ${exporting} messages`} /> : null}

        {/* the message area takes all the height, so the composer stays at the bottom while loading */}
        <View style={{ flex: 1 }}>
          {(!thread || thread.status === 'loading') && messages.length === 0 ? (
            <ChatSkeleton />
          ) : thread?.status === 'error' && messages.length === 0 ? (
            <EmptyState icon="cloud-offline-outline" title="Could not load messages" subtitle={thread.error} action={<Button title="Try again" onPress={() => chat.openConversation(conversationId)} />} />
          ) : messages.length === 0 ? (
            <EmptyState icon="hand-left-outline" title={`Say hello to ${fullName(other)}`} subtitle="Messages are delivered in real time and kept for when they are offline." />
          ) : (
            <FlatList
              ref={listRef}
              inverted
              data={messages}
              extraData={[selected, focusedId, highlight]}
              keyExtractor={(m) => String(m.message_id || m.client_message_id)}
              renderItem={renderItem}
              onEndReached={() => chat.loadOlder(conversationId)}
              onEndReachedThreshold={0.4}
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
                setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 120);
              }}
              ListFooterComponent={thread?.status === 'loading' ? <ActivityIndicator size="small" color={c.accent} style={{ marginVertical: theme.space.md }} /> : null}
              contentContainerStyle={{ paddingVertical: theme.space.md }}
              testID="message-list"
            />
          )}
        </View>

        {sendError ? <Banner kind="danger" text={sendError} action={<IconButton name="close" size={18} color={c.danger} onPress={() => setSendError(null)} accessibilityLabel="Dismiss" />} /> : null}

        {/* scheduled messages: a compact strip that opens into the list */}
        {pending.length ? (
          <View style={{ marginHorizontal: theme.space.sm, marginTop: theme.space.xs, borderRadius: 12, backgroundColor: c.surface, overflow: 'hidden' }} testID="scheduled-strip">
            <Pressable onPress={() => setScheduledOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: scheduledOpen }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.space.md, paddingVertical: 8 }}>
              <Ionicons name="time-outline" size={16} color={c.accent} />
              <Text style={{ flex: 1, color: c.text, fontSize: theme.font.sm, fontWeight: '600' }}>
                {pending.length} scheduled message{pending.length === 1 ? '' : 's'}{pending.some((s) => s.status === 'FAILED') ? ' · 1 failed' : ''}
              </Text>
              <Ionicons name={scheduledOpen ? 'chevron-down' : 'chevron-up'} size={16} color={c.textMuted} />
            </Pressable>
            {scheduledOpen ? pending.map((s) => (
              <View key={s.scheduled_message_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.space.md, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}
                testID={`scheduled-${s.scheduled_message_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: s.status === 'FAILED' ? c.danger : c.accent, fontSize: theme.font.xs, fontWeight: '700' }}>
                    {s.status === 'FAILED' ? `Not sent: ${s.failure_reason || 'failed'}` : `${dayLabel(s.send_at)}, ${timeOf(s.send_at)}`}
                  </Text>
                  <Text numberOfLines={2} style={{ color: c.text, fontSize: theme.font.sm }}>{s.content}</Text>
                </View>
                {s.status === 'PENDING' ? <IconButton name="create-outline" size={18} color={c.textMuted} accessibilityLabel="Edit scheduled message"
                  onPress={() => { setEditing({ kind: 'scheduled', item: s }); setReplyTo(null); setDraft(s.content); }} /> : null}
                <IconButton name="close-circle-outline" size={18} color={c.textMuted} accessibilityLabel={s.status === 'FAILED' ? 'Remove' : 'Cancel scheduled message'} onPress={() => cancelScheduled(s)} />
              </View>
            )) : null}
          </View>
        ) : null}

        {/* reply quote or edit banner above the composer */}
        {replyTo || editing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: theme.space.sm, marginTop: theme.space.xs, padding: 6, borderRadius: 12, backgroundColor: c.surface }} testID="composer-context">
            {replyTo ? (
              <ReplyQuote reply={replyTo} authorName={authorName(replyTo.sender_id)} compact style={{ flex: 1 }} />
            ) : (
              <View style={{ flex: 1, borderLeftWidth: 4, borderLeftColor: c.accent, paddingLeft: 8 }}>
                <Text style={{ color: c.accent, fontWeight: '700', fontSize: theme.font.sm }}>{editing.kind === 'message' ? 'Editing message' : 'Editing scheduled message'}</Text>
                <Text numberOfLines={1} style={{ color: c.textMuted, fontSize: theme.font.sm }}>{editing.kind === 'message' ? editing.message.content : editing.item.content}</Text>
              </View>
            )}
            <IconButton name="close" size={18} color={c.textMuted} accessibilityLabel={replyTo ? 'Cancel reply' : 'Cancel editing'} testID="composer-context-close"
              onPress={() => { setReplyTo(null); if (editing) { setEditing(null); setDraft(''); } }} />
          </View>
        ) : null}

        {/* composer: pill input and a round send button (hold it to schedule) */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: c.surface, borderRadius: 24, paddingLeft: theme.space.md, paddingRight: theme.space.sm, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 }}>
            <TextInput
              value={draft}
              onChangeText={(t) => setDraft(t.slice(0, MESSAGE_MAX_LENGTH))}
              placeholder={editing ? 'Edit message' : 'Message'}
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
          <Pressable onPress={send} onLongPress={openScheduleForDraft} delayLongPress={400} accessibilityRole="button" testID="send-button"
            accessibilityLabel={editing?.kind === 'message' ? 'Save edit' : 'Send'} accessibilityHint={editing?.kind === 'message' ? undefined : 'Hold to schedule'}
            style={({ pressed }) => ({ backgroundColor: canSend ? c.accentBright : c.textMuted, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, paddingLeft: editing?.kind === 'message' ? 0 : 3, opacity: pressed ? 0.85 : 1 })}>
            <Ionicons name={editing?.kind === 'message' ? 'checkmark' : 'send'} size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoider>

      <PopupMenu visible={menuOpen} items={menuItems} onClose={() => setMenuOpen(false)} />
      <Dialog {...dialog} onClose={() => setConfirm(null)} />

      <Dialog visible={renameOpen} icon="pencil-outline" title="Rename chat" message="Only you see this name. Leave it empty to use their name again."
        onClose={() => setRenameOpen(false)} actions={[{ label: 'Cancel' }, { label: 'Save', style: 'primary', onPress: rename, testID: 'rename-save' }]}>
        <TextField value={renameText} onChangeText={(t) => setRenameText(t.slice(0, 100))} placeholder={fullName(other)} autoFocus
          style={{ marginTop: theme.space.md, marginBottom: 0 }} testID="rename-input" accessibilityLabel="Chat name" />
      </Dialog>

      <ScheduleDialog visible={!!scheduleFor} initial={scheduleFor?.initial} title={scheduleFor?.item ? 'Reschedule message' : 'Schedule message'}
        confirmLabel={scheduleFor?.item ? 'Save' : 'Schedule'} onConfirm={confirmSchedule} onClose={() => setScheduleFor(null)} />
    </Screen>
  );
}
