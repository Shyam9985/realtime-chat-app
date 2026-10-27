import React, { useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { useToast } from '../contexts/MessageContext';
import { Screen, EmptyState, Button, Divider, Banner, Fab, KeyboardAvoider, ConversationListSkeleton, IconButton, PopupMenu, Dialog, SwitchRow, webNoOutline } from '../components/ui';
import { ConversationRow } from '../components/ConversationRow';
import { fullName, isGroup } from '../utils/chatFormat';

const FILTERS = [
  { key: 'all', label: 'All', empty: 'No chats yet' },
  { key: 'unread', label: 'Unread', empty: 'No unread chats' },
  { key: 'pinned', label: 'Pinned', empty: 'No pinned chats' },
  { key: 'groups', label: 'Groups', empty: 'No groups yet' },
];

const titleOf = (c) => c.title || fullName(c.other_user);

/*
 * The chat list, used twice: the Chats tab (archived = false) and the Archived screen (archived =
 * true). Search and the filter chips work together; long press opens the pin / archive switches,
 * which are personal to this user. "Read all" in the header menu asks first.
 */
export function ChatListView({ navigation, archived = false }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const toast = useToast();
  const chat = useChat();
  const { conversations, conversationsStatus, conversationsError, refreshConversations, myId, socketStatus } = chat;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmReadAll, setConfirmReadAll] = useState(false);
  const [optionsFor, setOptionsFor] = useState(null);   // conversation_id whose options sheet is open

  const inSection = useMemo(() => conversations.filter((x) => !!x.is_archived === archived), [conversations, archived]);
  const archivedChats = useMemo(() => conversations.filter((x) => x.is_archived), [conversations]);
  const unreadChats = useMemo(() => conversations.filter((x) => x.unread_count > 0), [conversations]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inSection.filter((x) => (filter === 'unread' ? x.unread_count > 0 : filter === 'pinned' ? x.is_pinned : filter === 'groups' ? isGroup(x) : true))
      .filter((x) => !q || titleOf(x).toLowerCase().includes(q) || (x.last_message?.content || '').toLowerCase().includes(q));
  }, [inSection, query, filter]);

  useLayoutEffect(() => {
    if (archived) return;
    navigation.setOptions({
      headerRight: () => <IconButton name="ellipsis-vertical" color={c.headerText} onPress={() => setMenuOpen(true)} accessibilityLabel="Chat list options" style={{ marginRight: theme.space.sm }} />,
    });
  }, [navigation, archived, c.headerText, theme.space.sm]);

  const options = conversations.find((x) => x.conversation_id === optionsFor) || null;
  const setOption = async (settings) => {
    try {
      await chat.updateConversationSettings(options.conversation_id, settings);
      if (settings.is_archived !== undefined) {
        toast.success(settings.is_archived ? 'Chat archived.' : 'Chat moved back to your chats.');
        setOptionsFor(null);
      }
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not update the chat.');
    }
  };

  const readAll = async () => {
    try {
      const result = await chat.readAll();
      toast.success(result.conversations ? `Marked ${result.conversations} chat${result.conversations === 1 ? '' : 's'} as read.` : 'Everything was already read.');
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not mark chats as read.');
    }
  };

  const openChat = (conversation) => navigation.navigate('Chat', { conversationId: conversation.conversation_id, title: titleOf(conversation) });

  if (conversationsStatus === 'loading') return <Screen><ConversationListSkeleton /></Screen>;

  const header = (
    <View style={{ backgroundColor: c.surface }}>
      <View style={{ paddingHorizontal: theme.space.md, paddingTop: theme.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, backgroundColor: c.inputBackground, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.md }}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={archived ? 'Search archived chats' : 'Search chats'} placeholderTextColor={c.placeholder} autoCapitalize="none" autoCorrect={false}
            style={[{ flex: 1, paddingVertical: 9, fontSize: theme.font.md, color: c.text }, webNoOutline]} testID="chat-search" accessibilityLabel="Search chats" />
          {query ? <Ionicons name="close-circle" size={18} color={c.textMuted} onPress={() => setQuery('')} accessibilityLabel="Clear search" /> : null}
        </View>
      </View>
      {!archived ? (
        <View style={{ flexDirection: 'row', gap: theme.space.sm, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm }} accessibilityRole="tablist">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: active }} testID={`filter-${f.key}`}
                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: active ? c.accentSoft : c.inputBackground }}>
                <Text style={{ color: active ? c.accent : c.textMuted, fontWeight: '700', fontSize: theme.font.sm }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : <View style={{ height: theme.space.sm }} />}
      {!archived && archivedChats.length ? (
        <Pressable onPress={() => navigation.navigate('Archived')} accessibilityRole="button" testID="archived-row"
          accessibilityLabel={`Archived, ${archivedChats.length} chat${archivedChats.length === 1 ? '' : 's'}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 12, backgroundColor: pressed ? c.surfaceAlt : c.surface })}>
          <View style={{ width: 52, alignItems: 'center' }}><Ionicons name="archive-outline" size={22} color={c.accent} /></View>
          <Text style={{ flex: 1, color: c.text, fontSize: theme.font.md, fontWeight: '600' }}>Archived</Text>
          {archivedChats.some((x) => x.unread_count > 0) ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentBright }} accessibilityLabel="Unread messages in archive" /> : null}
          <Text style={{ color: c.accent, fontWeight: '700', fontSize: theme.font.sm }}>{archivedChats.length}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const empty = query.trim()
    ? <EmptyState icon="search-outline" title="No chats match" subtitle={`Nothing matched “${query.trim()}”.`} />
    : archived ? <EmptyState icon="archive-outline" title="No archived chats" subtitle="Long press a chat and turn on Archive to move it here." />
      : filter !== 'all' ? <EmptyState icon="filter-outline" title={FILTERS.find((f) => f.key === filter).empty} action={<Button title="Show all chats" variant="secondary" onPress={() => setFilter('all')} />} />
        : <EmptyState title="No conversations yet" subtitle="Tap the green button to find a person by name or email and start chatting, or to start a group." />;

  return (
    <Screen>
      {socketStatus !== 'connected' ? <Banner kind="warning" text={socketStatus === 'connecting' ? 'Connecting…' : 'Offline. Messages will sync when you are back online.'} /> : null}

      {conversationsStatus === 'error' ? (
        <EmptyState icon="cloud-offline-outline" title="Could not load your chats" subtitle={conversationsError} action={<Button title="Try again" onPress={refreshConversations} />} />
      ) : (
        <KeyboardAvoider>
          <FlatList
            data={visible}
            keyExtractor={(x) => String(x.conversation_id)}
            renderItem={({ item }) => <ConversationRow conversation={item} myId={myId} onPress={() => openChat(item)} onLongPress={() => setOptionsFor(item.conversation_id)}
              onAvatarPress={isGroup(item) ? () => navigation.navigate('GroupInfo', { conversationId: item.conversation_id })
                : item.other_user ? () => navigation.navigate('ContactInfo', { userId: item.other_user.user_id }) : undefined} />}
            ItemSeparatorComponent={() => <Divider inset={82} />}
            ListHeaderComponent={header}
            ListEmptyComponent={empty}
            refreshControl={<RefreshControl refreshing={false} onRefresh={refreshConversations} tintColor={c.accent} />}
            contentContainerStyle={{ backgroundColor: c.surface, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            testID="conversation-list"
          />
        </KeyboardAvoider>
      )}

      {!archived ? <Fab icon="chatbox-ellipses" onPress={() => navigation.navigate('NewChat')} accessibilityLabel="New chat" /> : null}

      <PopupMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={[
        { label: 'Read all', icon: 'checkmark-done-outline', onPress: () => setConfirmReadAll(true) },
      ]} />

      <Dialog visible={confirmReadAll} icon="checkmark-done-outline" title={unreadChats.length ? 'Mark all as read?' : 'Nothing to mark'}
        message={unreadChats.length
          ? `${unreadChats.length} chat${unreadChats.length === 1 ? '' : 's'} with unread messages will be marked as read, archived ones included. The senders will see blue ticks.`
          : 'You have no unread messages.'}
        actions={unreadChats.length ? [{ label: 'Cancel' }, { label: 'Mark as read', style: 'primary', onPress: readAll, testID: 'confirm-read-all' }] : [{ label: 'OK', style: 'primary' }]}
        onClose={() => setConfirmReadAll(false)} />

      <Dialog visible={!!options} icon="chatbubbles-outline" title={options ? titleOf(options) : ''} onClose={() => setOptionsFor(null)}
        actions={[{ label: 'Done', style: 'primary', testID: 'chat-options-done' }]}>
        {options ? (
          <View style={{ marginTop: theme.space.md }} testID="chat-options">
            <SwitchRow icon="pin-outline" label="Pin" hint={options.is_archived ? 'Unarchive the chat to pin it.' : 'Keep this chat at the top.'} value={options.is_pinned}
              disabled={options.is_archived} onValueChange={(v) => setOption({ is_pinned: v })} testID="toggle-pin" />
            <Divider />
            <SwitchRow icon="archive-outline" label="Archive" hint="Move it out of your chats list." value={options.is_archived}
              onValueChange={(v) => setOption({ is_archived: v })} testID="toggle-archive" />
          </View>
        ) : null}
      </Dialog>
    </Screen>
  );
}

export default function ConversationsScreen({ navigation }) {
  return <ChatListView navigation={navigation} />;
}
