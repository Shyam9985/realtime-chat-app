import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import * as chatApi from '../services/chat.service';
import { TextField, Spinner, EmptyState, Avatar, Muted, Divider, KeyboardAvoider, PeopleListSkeleton } from './ui';
import { firstName, fullName } from '../utils/chatFormat';

/*
 * Search people by name or email and pick several (new group, add members). The picked ones sit as
 * chips above the results; tapping a chip or a picked row unpicks it. People already in the group
 * (excludeIds) and people you blocked are shown but cannot be picked. max: how many can be picked.
 */
export default function PeoplePicker({ selected, onChange, excludeIds = [], max, footer }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');   // idle | searching | done | error
  const [error, setError] = useState(null);

  useEffect(() => {
    const text = query.trim();
    if (!text) { setResults([]); setStatus('idle'); return undefined; }
    setStatus('searching');
    const timer = setTimeout(async () => {
      try {
        setResults(await chatApi.searchUsers(text, 30));
        setStatus('done');
      } catch (e) {
        setError(e?.error || e?.message || 'Search failed.');
        setStatus('error');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const isPicked = (u) => selected.some((s) => s.user_id === u.user_id);
  const full = max != null && selected.length >= max;
  const toggle = (u) => {
    if (isPicked(u)) onChange(selected.filter((s) => s.user_id !== u.user_id));
    else if (!full) onChange([...selected, u]);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, backgroundColor: c.background }}>
        <TextField icon="search" value={query} onChangeText={setQuery} placeholder="Search by name or email" autoFocus autoCapitalize="none" autoCorrect={false} testID="people-search"
          right={status === 'searching' ? <Spinner size="small" style={{ marginRight: 12 }} /> : null} style={{ marginBottom: theme.space.sm }} />
        {selected.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.sm, paddingBottom: theme.space.sm }} keyboardShouldPersistTaps="handled" testID="picked-people">
            {selected.map((u) => (
              <Pressable key={u.user_id} onPress={() => toggle(u)} accessibilityRole="button" accessibilityLabel={`Remove ${fullName(u)}`} testID={`picked-${u.user_id}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: c.accentSoft }}>
                <Avatar user={u} size={26} />
                <Text style={{ color: c.text, fontSize: theme.font.sm, fontWeight: '600' }}>{firstName(fullName(u))}</Text>
                <Ionicons name="close" size={14} color={c.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Muted style={{ marginBottom: theme.space.sm }}>
          {selected.length ? `${selected.length} selected${max != null ? ` (up to ${max})` : ''}` : 'Search, then tap people to add them.'}
        </Muted>
      </View>
      <KeyboardAvoider>
        {status === 'searching' && results.length === 0 ? (
          <PeopleListSkeleton />
        ) : status === 'idle' ? (
          <EmptyState icon="people-outline" title="Find people" subtitle="Type at least one letter of their name or email." />
        ) : status === 'error' ? (
          <EmptyState icon="alert-circle-outline" title="Search failed" subtitle={error} />
        ) : status === 'done' && results.length === 0 ? (
          <EmptyState icon="search-outline" title="No matches" subtitle={`Nobody matched “${query.trim()}”.`} />
        ) : (
          <FlatList
            data={results}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(u) => String(u.user_id)}
            ItemSeparatorComponent={() => <Divider inset={72} />}
            contentContainerStyle={{ backgroundColor: c.surface }}
            renderItem={({ item }) => {
              const inGroup = excludeIds.includes(item.user_id);
              const blocked = !!item.blocked_by_me;
              const picked = isPicked(item);
              const disabled = inGroup || blocked || (!picked && full);
              return (
                <Pressable onPress={() => toggle(item)} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: picked, disabled }}
                  accessibilityLabel={fullName(item)} testID={`person-${item.user_id}`}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 10, backgroundColor: pressed ? c.surfaceAlt : c.surface, opacity: disabled && !picked ? 0.55 : 1 })}>
                  <Avatar user={item} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: theme.font.md, fontWeight: '600', color: c.text }}>{fullName(item)}</Text>
                    <Muted numberOfLines={1}>{inGroup ? 'Already in the group' : blocked ? 'Blocked. Unblock them to add them.' : item.email}</Muted>
                  </View>
                  {inGroup ? <Ionicons name="checkmark-circle" size={24} color={c.textMuted} />
                    : <Ionicons name={picked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={picked ? c.accent : c.textMuted} />}
                </Pressable>
              );
            }}
          />
        )}
        {footer}
      </KeyboardAvoider>
    </View>
  );
}
