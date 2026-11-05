/*
 * Adds a public sticker pack to the YaapZone sticker store:
 *   npm run import-stickers -- <link> [--default] [--server http://localhost:4200]
 *
 *   <link>     a share link from signalstickers.com / signal.art
 *              (…/pack/<id>?key=<key>  or  …/addstickers/#pack_id=<id>&pack_key=<key>)
 *              or from the Sticker.ly app (https://sticker.ly/s/<code>)
 *   --default  every new user gets this pack in their drawer from the start
 *   --server   which server (default: the one in mobile/.env.production, i.e. Render; or PUBLISH_API_URL)
 *
 * The server downloads and decrypts the pack, makes every sticker uniform and stores it, then the pack
 * shows in the app's sticker store. Needs RELEASE_PUBLISH_KEY in .env (the same value as on the server).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });

const ROOT = path.join(__dirname, '..');
const fail = (message) => { console.error(`\nERROR: ${message}`); process.exit(1); };

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const link = args.find((a) => !a.startsWith('--') && a !== option('--server'));
if (!link) fail('Give the pack link: npm run import-stickers -- "https://signalstickers.com/pack/<id>?key=<key>"');

const key = process.env.RELEASE_PUBLISH_KEY;
if (!key) fail('RELEASE_PUBLISH_KEY is not set in .env (the same value as on the server).');
const apiUrl = (option('--server') || process.env.PUBLISH_API_URL
    || (fs.readFileSync(path.join(ROOT, 'mobile/.env.production'), 'utf8').match(/^EXPO_PUBLIC_API_URL=(.+)$/m) || [])[1] || '').trim().replace(/\/+$/, '');
if (!apiUrl) fail('No server url: pass --server, or set PUBLISH_API_URL or EXPO_PUBLIC_API_URL in mobile/.env.production.');

(async () => {
    console.log(`import-stickers: ${link}\n>> Importing on ${apiUrl} (a sleeping Render server can take a minute to wake; a big pack takes a while)`);
    const res = await fetch(`${apiUrl}/apiv1/stickers/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-release-key': key },
        body: JSON.stringify({ link, is_default: args.includes('--default') }),
        signal: AbortSignal.timeout(10 * 60 * 1000)
    }).catch((error) => fail(`Could not reach the server: ${error.message}`));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) fail(`The server refused (${res.status}): ${body.message || body.error || JSON.stringify(body)}`);
    const { pack, already } = body.data;
    console.log(`\n${already ? 'Already in the store' : 'Added to the store'}: "${pack.title}"${pack.author ? ` by ${pack.author}` : ''} - ${pack.sticker_count} sticker(s)${pack.is_animated ? ', animated' : ''}${pack.is_default ? ', default pack' : ''} (pack id ${pack.pack_id})`);
})();
