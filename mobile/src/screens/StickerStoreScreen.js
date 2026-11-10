import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/MessageContext';
import { Screen, Button, EmptyState, Spinner, Banner, TextField } from '../components/ui';
import { StickerImage } from '../components/StickerImage';
import * as stickers from '../services/stickers.service';

/*
 * The sticker store: every pack, with its cover, author and size, and an Add / Remove button that puts
 * it in (or takes it out of) the user's drawer. Tapping a pack opens its stickers right there.
 */
export default function StickerStoreScreen({ route }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const toast = useToast();
  const [link, setLink] = useState(route?.params?.link || '');     // a Signal pack link to bring in
  const [importing, setImporting] = useState(false);
  const [packs, setPacks] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);         // pack_id whose stickers are shown
  const [details, setDetails] = useState({});     // pack_id -> stickers
  const [busy, setBusy] = useState(null);         // pack_id being added or removed

  const load = useCallback(async () => {
    setError(null);
    try { setPacks(await stickers.getStore()); } catch (e) { setError(e?.message || e?.error || 'Could not load the store.'); setPacks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // a public Signal pack by its link: the server fetches it into the store (for everyone) and this drawer
  const importLink = async () => {
    const text = link.trim();
    if (!text) { toast.info('Paste a sticker pack link from signalstickers.com first.'); return; }
    setImporting(true);
    try {
      const { pack, already } = await stickers.importPack(text);
      setLink('');
      toast.success(already ? `“${pack.title}” is in your stickers now.` : `“${pack.title}” added to your stickers.`);
      await load();
    } catch (e) {
      toast.error(e?.message || e?.error || 'Could not add that pack.');
    } finally {
      setImporting(false);
    }
  };

  const toggleOpen = async (pack) => {
    const next = open === pack.pack_id ? null : pack.pack_id;
    setOpen(next);
    if (next && !details[next]) {
      try { const full = await stickers.getPack(next); setDetails((d) => ({ ...d, [next]: full.stickers })); }
      catch { setDetails((d) => ({ ...d, [next]: [] })); }
    }
  };

  const toggleAdded = async (pack) => {
    setBusy(pack.pack_id);
    try {
      if (pack.added) { await stickers.removePack(pack.pack_id); toast.info(`“${pack.title}” removed from your stickers.`); }
      else { await stickers.addPack(pack.pack_id); toast.success(`“${pack.title}” added to your stickers.`); }
      setPacks((list) => list.map((p) => (p.pack_id === pack.pack_id ? { ...p, added: !pack.added } : p)));
    } catch (e) {
      toast.error(e?.message || e?.error || 'Could not change your stickers.');
    } finally {
      setBusy(null);
    }
  };

  const renderPack = ({ item }) => {
    const expanded = open === item.pack_id;
    const grid = details[item.pack_id];
    return (
      <View style={{ backgroundColor: c.surface, borderRadius: theme.radius.md, marginHorizontal: theme.space.md, marginTop: theme.space.sm, overflow: 'hidden' }} testID={`store-pack-${item.pack_id}`}>
        <Pressable onPress={() => toggleOpen(item)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${item.title}, ${item.sticker_count} stickers`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, padding: theme.space.md }}>
          <StickerImage stickerId={item.cover_sticker_id} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontWeight: '700', fontSize: theme.font.md }}>{item.title}</Text>
              {item.is_mine ? <Text style={{ color: c.accent, fontSize: theme.font.xs, fontWeight: '700', backgroundColor: c.accentSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 }} testID="pack-mine">Only you</Text> : null}
            </View>
            {item.author ? <Text numberOfLines={1} style={{ color: c.textMuted, fontSize: theme.font.sm }}>{item.author}</Text> : null}
            <Text style={{ color: c.textMuted, fontSize: theme.font.xs, marginTop: 2 }}>{item.sticker_count} stickers{item.is_animated ? ' · animated' : ''}</Text>
          </View>
          <Button title={item.added ? 'Remove' : 'Add'} variant={item.added ? 'ghost' : 'primary'} loading={busy === item.pack_id} onPress={() => toggleAdded(item)}
            icon={item.added ? undefined : 'add'} style={{ paddingVertical: 8, paddingHorizontal: 14 }} testID={`store-toggle-${item.pack_id}`} accessibilityLabel={item.added ? `Remove ${item.title}` : `Add ${item.title}`} />
        </Pressable>
        {expanded ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: theme.space.sm, paddingBottom: theme.space.sm, borderTopWidth: 1, borderTopColor: c.border }}>
            {!grid ? <Spinner size="small" style={{ width: '100%', paddingVertical: theme.space.md }} /> : grid.map((s) => (
              <View key={s.sticker_id} style={{ width: '25%', alignItems: 'center', paddingVertical: 6 }}>
                <StickerImage stickerId={s.sticker_id} size={70} accessibilityLabel={`Sticker${s.emoji ? ` ${s.emoji}` : ''}`} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  // the way in for new packs: shown whether or not the store has anything to list (an empty store
  // used to hide it, so people without packs never saw how to bring one)
  const importBox = (
    <View style={{ backgroundColor: c.surface, borderRadius: theme.radius.md, marginHorizontal: theme.space.md, marginTop: theme.space.md, padding: theme.space.md }} testID="store-import">
      <Text style={{ color: c.text, fontWeight: '700', fontSize: theme.font.md }}>Bring a pack</Text>
      <Text style={{ color: c.textMuted, fontSize: theme.font.sm, marginTop: 2, marginBottom: theme.space.sm }}>
        Paste a pack's share link from the Sticker.ly app (sticker.ly/s/…) or from signalstickers.com, and it is yours: only you see it here and in your drawer. In Sticker.ly: open a pack → Share → copy link.
      </Text>
      <TextField value={link} onChangeText={setLink} placeholder="https://sticker.ly/s/… or signalstickers.com/pack/…" autoCapitalize="none" autoCorrect={false} keyboardType="url"
        style={{ marginBottom: theme.space.sm }} testID="store-import-link" accessibilityLabel="Sticker pack link" />
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        <Button title="Add pack" icon="download-outline" loading={importing} onPress={importLink} style={{ flex: 1 }} testID="store-import-add" />
        <Button title="Browse packs" variant="ghost" icon="open-outline" onPress={() => Linking.openURL('https://signalstickers.com').catch(() => {})} style={{ flex: 1 }} />
      </View>
    </View>
  );

  return (
    <Screen>
      {error ? <Banner kind="danger" text={error} action={<Button title="Retry" variant="ghost" onPress={load} style={{ paddingVertical: 6, paddingHorizontal: 10 }} />} /> : null}
      {packs == null ? <Spinner /> : !packs.length ? (
        <View style={{ flex: 1 }}>
          {importBox}
          <EmptyState icon="images-outline" title="No packs yet" subtitle="Bring your first pack with a link above. Packs you add show up here and in your sticker drawer." />
        </View>
      ) : (
        <FlatList data={packs} keyExtractor={(p) => String(p.pack_id)} renderItem={renderPack} extraData={[open, details, busy]}
          contentContainerStyle={{ paddingBottom: theme.space.xl }}
          ListHeaderComponent={(
            <View>
              {importBox}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.space.md, paddingTop: theme.space.md }}>
                <Ionicons name="information-circle-outline" size={16} color={c.textMuted} />
                <Text style={{ flex: 1, color: c.textMuted, fontSize: theme.font.sm }}>Add a pack to see it in your sticker drawer. Tap any sticker in a chat to add it to your stickers.</Text>
              </View>
            </View>
          )}
          testID="sticker-store" />
      )}
    </Screen>
  );
}
