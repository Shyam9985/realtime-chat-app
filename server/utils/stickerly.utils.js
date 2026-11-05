const { log } = require('./log.utils');

/*
 * Reading a Sticker.ly pack from its share link (https://sticker.ly/s/<code>), the app most WhatsApp
 * sticker packs come from. The link opens a public web page that lists the pack's name, its maker and
 * every sticker as a WebP on Sticker.ly's CDN (animated packs are animated WebP), so a pack is read
 * the way a browser reads it: the page, then each image. There is no key: the page is public.
 */
const PAGE = 'https://sticker.ly/s/';
const CDN = 'https://stickerly.pstatic.net/sticker_pack/';
// a browser's name: the page serves its sticker list to browsers
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_STICKERS = 200;
const TIMEOUT_MS = 20000;
const DOWNLOADS_AT_ONCE = 4;

const fail = (message) => { const error = new Error(message); error.name = 'importFailed'; return error; };
const decode = (text) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// the pack code out of a share link (sticker.ly/s/ABC123), or null
exports.parseLink = (link) => {
    const m = String(link || '').match(/sticker\.ly\/s\/([A-Za-z0-9]{4,12})\b/i);
    return m ? m[1].toUpperCase() : null;
};

// what the page says about the pack: its name, its maker, its stickers (in page order, this pack only:
// the page also shows other packs)
exports.parsePage = (html, code) => {
    const text = String(html || '');
    const name = decode((text.match(/class="sticker_name"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '');
    const author = decode((text.match(/class="sticker_author"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
    const urls = [];
    const seen = new Set();
    const pattern = new RegExp(`src="(${CDN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[^"]*/${code}/[^"]*\\.webp)"`, 'gi');
    for (const m of text.matchAll(pattern)) { if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); } }
    return { name, author, urls };
};

const get = async (url, as) => {
    let res;
    try {
        res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: as === 'text' ? 'text/html' : 'image/webp,image/*' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
        throw fail(`Could not reach Sticker.ly: ${error.message}`);
    }
    if (res.status === 404) throw fail('Sticker.ly does not know this pack.');
    if (!res.ok) throw fail(`Sticker.ly answered ${res.status}.`);
    if (as === 'text') return res.text();
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) throw fail('A sticker file is too large.');
    return bytes;
};

// the whole pack: { title, author, cover: null, stickers: [{ id, emoji, bytes }] }, a few downloads at a time
exports.fetchPack = async (code) => {
    log(`in stickerly fetchPack ${code}`);
    const page = exports.parsePage(await get(`${PAGE}${code}`, 'text'), code);
    if (!page.urls.length) throw fail('That Sticker.ly page shows no stickers (the pack may be private or gone).');
    if (page.urls.length > MAX_STICKERS) throw fail(`This pack has ${page.urls.length} stickers; the most allowed is ${MAX_STICKERS}.`);
    const stickers = page.urls.map((url, i) => ({ id: i, emoji: null, url, bytes: null }));
    let next = 0;
    const worker = async () => {
        while (next < stickers.length) {
            const sticker = stickers[next++];
            sticker.bytes = await get(sticker.url, 'bytes');
        }
    };
    await Promise.all(Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, stickers.length) }, worker));
    return { title: page.name, author: page.author, cover: null, stickers };
};
