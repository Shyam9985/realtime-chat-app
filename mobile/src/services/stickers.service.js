import { useEffect, useState } from "react";
import { Directory, File, Paths } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { get, post, put, remove } from "../store/api.service";
import * as tokenStore from "../store/tokenStore";
import { API_URL, API_PREFIX } from "../config";

/*
 * Stickers: the store (packs the developer imported), this user's drawer (the packs they added and the
 * stickers they starred) and the images. A sticker message carries the sticker's id as its encrypted
 * text; the image is fetched once by id and kept in the phone's cache folder for good (a sticker never
 * changes), so a chat full of stickers costs one download per distinct sticker.
 * Like chat.service, these THROW the server's error object.
 */
const data = (promise) => promise.then((r) => r.data);

export const getStore = () => data(get("stickers/store")).then((d) => d.packs);
export const getPack = (packId) => data(get(`stickers/packs/${packId}`)).then((d) => d.pack);
export const addFavourite = (stickerId) => data(put(`stickers/favourites/${stickerId}`, {})).then(refreshDrawer);
export const removeFavourite = (stickerId) => data(remove(`stickers/favourites/${stickerId}`)).then(refreshDrawer);
export const addPack = (packId) => data(post(`stickers/packs/${packId}/mine`, {})).then(refreshDrawer);
// a public Signal pack by its share link: the server imports it into the store and this user's drawer
export const importPack = (link) => data(post("stickers/packs", { link })).then(refreshDrawer);
// is this text a Signal sticker pack link (signal.art/addstickers/... or signalstickers.com/pack/...)
export const isPackLink = (text) => /signal\.art\/addstickers|signalstickers\.(com|org)\/pack\//i.test(text || "");
export const removePack = (packId) => data(remove(`stickers/packs/${packId}/mine`)).then(refreshDrawer);

// ---- the drawer: fetched once, shared by every screen, refreshed after each change
let drawer = null;                 // { packs: [{ ...pack, stickers }], favourites, max_favourites }
let drawerPromise = null;
const listeners = new Set();
const notify = () => listeners.forEach((l) => l(drawer));

export async function loadDrawer(force = false) {
    if (drawer && !force) return drawer;
    if (!drawerPromise) {
        drawerPromise = data(get("stickers/mine")).then((d) => { drawer = d; notify(); return d; }).finally(() => { drawerPromise = null; });
    }
    return drawerPromise;
}
export const refreshDrawer = (result) => loadDrawer(true).then(() => result);
export const forgetDrawer = () => { drawer = null; };
export const isFavourite = (stickerId) => !!drawer?.favourites.some((s) => s.sticker_id === stickerId);

// the drawer as state: null until loaded, then live
export function useDrawer() {
    const [value, setValue] = useState(drawer);
    useEffect(() => {
        listeners.add(setValue);
        loadDrawer().catch(() => {});
        return () => listeners.delete(setValue);
    }, []);
    return value;
}

// ---- recent stickers: this phone only, the last 24 sent
const RECENT_KEY = "stickers.recent";
const RECENT_MAX = 24;
let recent = null;
export async function loadRecent() {
    if (recent) return recent;
    try { recent = JSON.parse(await AsyncStorage.getItem(RECENT_KEY)) || []; } catch { recent = []; }
    return recent;
}
export async function pushRecent(sticker) {
    const list = await loadRecent();
    recent = [sticker, ...list.filter((s) => s.sticker_id !== sticker.sticker_id)].slice(0, RECENT_MAX);
    try { await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* the list is a convenience */ }
    notify();
    return recent;
}
export const clearRecent = async () => { recent = []; try { await AsyncStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } notify(); };

// ---- images: downloaded once into the cache folder, then served from there
const cacheDir = new Directory(Paths.cache, "stickers");
const uris = new Map();            // stickerId -> file uri (this run)
const inFlight = new Map();
export function stickerUri(stickerId) {
    const id = Number(stickerId);
    if (!id) return Promise.resolve(null);
    if (uris.has(id)) return Promise.resolve(uris.get(id));
    if (inFlight.has(id)) return inFlight.get(id);
    const task = (async () => {
        try {
            const file = new File(cacheDir, `${id}.img`);
            if (!(file.exists && file.size > 0)) {
                cacheDir.create({ intermediates: true, idempotent: true });
                const token = await tokenStore.getToken();
                await File.downloadFileAsync(`${API_URL}${API_PREFIX}/stickers/${id}/image`, file, { idempotent: true, headers: token ? { "access-token": `Bearer ${token}` } : {} });
            }
            uris.set(id, file.uri);
            return file.uri;
        } catch {
            return null;
        } finally {
            inFlight.delete(id);
        }
    })();
    inFlight.set(id, task);
    return task;
}

// the sticker's local image uri as state (null while it downloads or when it cannot be fetched)
export function useStickerUri(stickerId) {
    const id = Number(stickerId);
    const [uri, setUri] = useState(() => uris.get(id) || null);
    useEffect(() => {
        let alive = true;
        if (uris.has(id)) { setUri(uris.get(id)); return undefined; }
        setUri(null);
        stickerUri(id).then((value) => { if (alive) setUri(value); });
        return () => { alive = false; };
    }, [id]);
    return uri;
}
