import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useChat } from '../contexts/ChatContext';
import * as chatApi from '../services/chat.service';
import { Screen, TextField, Spinner, EmptyState, Avatar, Muted, Divider, KeyboardAvoider } from '../components/ui';
import { fullName } from '../utils/chatFormat';

export default function NewChatScreen({ navigation }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { startConversation } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');   // idle | searching | done | error
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(null);

  // debounced search
  useEffect(() => {
    const text = query.trim();
    if (!text) { setResults([]); setStatus('idle'); return undefined; }
    setStatus('searching');
    const timer = setTimeout(async () => {
      try {
        setResults(await chatApi.searchUsers(text));
        setStatus('done');
      } catch (e) {
        setError(e?.error || e?.message || 'Search failed.');
        setStatus('error');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const open = async (user) => {
    setOpening(user.user_id);
    try {
      const conversation = await startConversation(user.user_id);
      navigation.replace('Chat', { conversationId: conversation.conversation_id, title: fullName(user) });
    } catch (e) {
      setError(e?.error || e?.message || 'Could not open the chat.');
      setStatus('error');
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen>
      <View style={{ padding: theme.space.lg, paddingBottom: 0 }}>
        <TextField icon="search" value={query} onChangeText={setQuery} placeholder="Search by name or email" autoFocus autoCapitalize="none" autoCorrect={false} testID="search-input"
          right={status === 'searching' ? <Spinner size="small" style={{ marginRight: 12 }} /> : null} />
      </View>
      <KeyboardAvoider>
        {status === 'idle' ? (
          <EmptyState icon="people-outline" title="Find someone to talk to" subtitle="Type at least one letter of their name or email." />
        ) : status === 'error' ? (
          <EmptyState icon="alert-circle-outline" title="Search failed" subtitle={error} />
        ) : status === 'done' && results.length === 0 ? (
          <EmptyState icon="search-outline" title="No matches" subtitle={`Nobody matched “${query.trim()}”.`} />
        ) : (
          <FlatList
            data={results}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(u) => String(u.user_id)}
            ItemSeparatorComponent={Divider}
            contentContainerStyle={{ backgroundColor: c.surface }}
            renderItem={({ item }) => (
              <Pressable onPress={() => open(item)} disabled={opening != null} accessibilityRole="button" accessibilityLabel={`Chat with ${fullName(item)}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md, backgroundColor: pressed ? c.surfaceAlt : c.surface })}>
                <Avatar user={item} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: theme.font.md, fontWeight: '600', color: c.text }}>{fullName(item)}</Text>
                  <Muted numberOfLines={1}>{item.email}</Muted>
                </View>
                {item.blocked_by_me ? <Ionicons name="ban" size={16} color={c.danger} /> : null}
                {opening === item.user_id ? <Spinner size="small" /> : <Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
              </Pressable>
            )}
          />
        )}
      </KeyboardAvoider>
    </Screen>
  );
}
