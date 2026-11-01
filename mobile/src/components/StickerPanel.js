import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/MessageContext';
import { StickerImage } from './StickerImage';
import { Button, Spinner } from './ui';
import * as stickers from '../services/stickers.service';

/*
 * The sticker drawer under the composer, laid out like WhatsApp's: a tab strip (Recent, Favourites, one
 * tab per pack in the drawer, then "+" for the store) and a grid of the chosen tab's stickers. Tapping a
 * sticker sends it; holding one stars it (or un-stars it).
 */
export const STICKER_PANEL_HEIGHT = 290;
const COLUMNS = 4;

export function StickerPanel({ onSend, onOpenStore, height = STICKER_PANEL_HEIGHT }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const toast = useToast();
  const drawer = stickers.useDrawer();
  const [recent, setRecent] = useState(null);
  const [tab, setTab] = useState(null);           // 'recent' | 'favourites' | pack_id

  useEffect(() => { stickers.loadRecent().then(setRecent); }, [drawer]);
  // first open: Recent when there is something recent, else Favourites when any, else the first pack
  useEffect(() => {
    if (tab != null || !drawer || recent == null) return;
    setTab(recent.length ? 'recent' : drawer.favourites.length ? 'favourites' : drawer.packs[0]?.pack_id ?? 'recent');
  }, [drawer, recent, tab]);

  const list = useMemo(() => {
    if (!drawer) return [];
    if (tab === 'recent') return recent || [];
    if (tab === 'favourites') return drawer.favourites;
    return drawer.packs.find((p) => p.pack_id === tab)?.stickers || [];
  }, [drawer, recent, tab]);

  const send = (sticker) => { onSend(sticker); stickers.pushRecent(sticker).catch(() => {}); };
  const star = async (sticker) => {
    try {
      if (stickers.isFavourite(sticker.sticker_id)) { await stickers.removeFavourite(sticker.sticker_id); toast.info('Removed from favourites.'); }
      else { await stickers.addFavourite(sticker.sticker_id); toast.success('Added to favourites.'); }
    } catch (e) { toast.error(e?.message || e?.error || 'Could not change favourites.'); }
  };

  const tabs = drawer ? [
    { key: 'recent', icon: 'time-outline', label: 'Recent' },
    { key: 'favourites', icon: 'star-outline', label: 'Favourites' },
    ...drawer.packs.map((p) => ({ key: p.pack_id, cover: p.cover_sticker_id, label: p.title })),
  ] : [];

  const empty = !drawer ? null
    : !drawer.packs.length && tab !== 'favourites' && tab !== 'recent' ? { icon: 'images-outline', text: 'No sticker packs yet.', action: 'Browse the store' }
      : tab === 'recent' && !list.length ? { icon: 'time-outline', text: 'Stickers you send show up here.', action: drawer.packs.length ? null : 'Browse the store' }
        : tab === 'favourites' && !list.length ? { icon: 'star-outline', text: 'Hold a sticker to add it to your favourites.' }
          : null;

  return (
    <View style={{ height, backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.border }} testID="sticker-panel">
      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4 }} style={{ flex: 1 }}>
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable key={String(t.key)} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t.label} testID={`sticker-tab-${t.key}`}
                style={{ width: 48, height: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: active ? c.accent : 'transparent' }}>
                {t.icon ? <Ionicons name={t.icon} size={22} color={active ? c.accent : c.textMuted} /> : <StickerImage stickerId={t.cover} size={30} />}
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={onOpenStore} accessibilityRole="button" accessibilityLabel="Sticker store" testID="sticker-store-open"
          style={{ width: 48, height: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: c.border }}>
          <Ionicons name="add-circle-outline" size={24} color={c.accent} />
        </Pressable>
      </View>

      {!drawer ? <Spinner size="small" style={{ flex: 1 }} /> : empty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.lg, gap: theme.space.sm }}>
          <Ionicons name={empty.icon} size={30} color={c.textMuted} />
          <Text style={{ color: c.textMuted, fontSize: theme.font.sm, textAlign: 'center' }}>{empty.text}</Text>
          {empty.action ? <Button title={empty.action} variant="ghost" onPress={onOpenStore} style={{ paddingVertical: 6 }} /> : null}
        </View>
      ) : (
        <FlatList
          data={list}
          numColumns={COLUMNS}
          keyExtractor={(s) => String(s.sticker_id)}
          contentContainerStyle={{ padding: 6 }}
          renderItem={({ item }) => (
            <View style={{ flex: 1 / COLUMNS, alignItems: 'center', paddingVertical: 6 }}>
              <StickerImage stickerId={item.sticker_id} size={74} onPress={() => send(item)} onLongPress={() => star(item)}
                accessibilityLabel={`Send sticker${item.emoji ? ` ${item.emoji}` : ''}`} testID={`sticker-${item.sticker_id}`} />
            </View>
          )}
          testID="sticker-grid"
        />
      )}
    </View>
  );
}
