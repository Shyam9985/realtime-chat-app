import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import { Screen, Spinner, EmptyState, Button, Divider, Banner, Fab, KeyboardAvoider, webNoOutline } from '../components/ui';
import { ConversationRow } from '../components/ConversationRow';
import { fullName } from '../utils/chatFormat';

export default function ConversationsScreen({ navigation }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { conversations, conversationsStatus, conversationsError, refreshConversations, myId, socketStatus } = useChat();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((x) => (x.title || fullName(x.other_user)).toLowerCase().includes(q) || (x.last_message?.content || '').toLowerCase().includes(q));
  }, [conversations, query]);

  const openChat = (conversation) => navigation.navigate('Chat', { conversationId: conversation.conversation_id, title: conversation.title || fullName(conversation.other_user) });

  if (conversationsStatus === 'loading') return <Screen><Spinner style={{ marginTop: theme.space.xxl }} /></Screen>;

  return (
    <Screen>
      {socketStatus !== 'connected' ? <Banner kind="warning" text={socketStatus === 'connecting' ? 'Connecting…' : 'Offline. Messages will sync when you are back online.'} /> : null}

      {conversationsStatus === 'error' ? (
        <EmptyState icon="cloud-offline-outline" title="Could not load your chats" subtitle={conversationsError} action={<Button title="Try again" onPress={refreshConversations} />} />
      ) : conversations.length === 0 ? (
        <EmptyState title="No conversations yet" subtitle="Tap the green button to find a person by name or email and start chatting." />
      ) : (
        <KeyboardAvoider>
          <FlatList
            data={visible}
            keyExtractor={(x) => String(x.conversation_id)}
            renderItem={({ item }) => <ConversationRow conversation={item} myId={myId} onPress={() => openChat(item)}
              onAvatarPress={item.other_user ? () => navigation.navigate('ContactInfo', { userId: item.other_user.user_id }) : undefined} />}
            ItemSeparatorComponent={() => <Divider inset={82} />}
            ListHeaderComponent={
              <View style={{ paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, backgroundColor: c.surface }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, backgroundColor: c.inputBackground, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.md }}>
                  <Ionicons name="search" size={18} color={c.textMuted} />
                  <TextInput value={query} onChangeText={setQuery} placeholder="Search chats" placeholderTextColor={c.placeholder} autoCapitalize="none" autoCorrect={false}
                    style={[{ flex: 1, paddingVertical: 9, fontSize: theme.font.md, color: c.text }, webNoOutline]} testID="chat-search" accessibilityLabel="Search chats" />
                  {query ? <Ionicons name="close-circle" size={18} color={c.textMuted} onPress={() => setQuery('')} /> : null}
                </View>
              </View>
            }
            ListEmptyComponent={<EmptyState icon="search-outline" title="No chats match" subtitle={`Nothing matched “${query.trim()}”.`} />}
            refreshControl={<RefreshControl refreshing={false} onRefresh={refreshConversations} tintColor={c.accent} />}
            contentContainerStyle={{ backgroundColor: c.surface, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            testID="conversation-list"
          />
        </KeyboardAvoider>
      )}

      <Fab icon="chatbox-ellipses" onPress={() => navigation.navigate('NewChat')} accessibilityLabel="New chat" />
    </Screen>
  );
}
