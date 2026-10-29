/*
 * Publishes a built YaapZone APK as an update:
 *   npm run publish-release -- --notes "What's new in this version" [--mandatory] [--skip-upload]
 *
 *   1. checks that the APK really is the version in mobile/app.json (so an old build is never announced)
 *   2. uploads it to a GitHub Release v<version> with the GitHub CLI (gh; run `gh auth login` once)
 *   3. asks the server (POST /app/releases, with RELEASE_PUBLISH_KEY from .env) to record the release
 *      and tell every registered phone "YaapZone <version> is available"
 * --skip-upload: the GitHub Release already exists (a re-run after step 3 failed).
 * The server is the one in mobile/.env.production (Render) unless PUBLISH_API_URL is set.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ quiet: true });

const ROOT = path.join(__dirname, '..');
const APK = path.join(ROOT, 'mobile/android/app/build/outputs/apk/release/app-release.apk');
// plain text only: some windows consoles drop symbols like arrows and ticks (and the lines with them)
const fail = (message) => { console.error(`\nERROR: ${message}`); process.exit(1); };
const step = (message) => console.log(`\n>> ${message}`);
console.log('publish-release: starting');

const args = process.argv.slice(2);
// the words after an option, up to the next --option: powershell can drop the quotes around the notes
const option = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const words = [];
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j += 1) words.push(args[j]);
    return words.join(' ');
};
const notes = option('--notes');
const mandatory = args.includes('--mandatory');
const skipUpload = args.includes('--skip-upload');
if (!notes || !notes.trim()) fail('Say what is new: --notes "Groups and profile editing"');

const { expo } = JSON.parse(fs.readFileSync(path.join(ROOT, 'mobile/app.json'), 'utf8'));
const version = expo.version;
const versionCode = expo.android?.versionCode;
const key = process.env.RELEASE_PUBLISH_KEY;
if (!key) fail('RELEASE_PUBLISH_KEY is not set in .env (the same value as on Render).');
const apiUrl = (process.env.PUBLISH_API_URL
    || (fs.readFileSync(path.join(ROOT, 'mobile/.env.production'), 'utf8').match(/^EXPO_PUBLIC_API_URL=(.+)$/m) || [])[1] || '').trim().replace(/\/+$/, '');
if (!apiUrl) fail('No server url: set PUBLISH_API_URL or EXPO_PUBLIC_API_URL in mobile/.env.production.');

// the version android reads from the apk itself (aapt2 from the android sdk build tools)
const apkVersionCode = () => {
    const tools = path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/build-tools');
    const newest = fs.existsSync(tools) ? fs.readdirSync(tools).sort().pop() : null;
    const aapt2 = newest && path.join(tools, newest, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
    if (!aapt2 || !fs.existsSync(aapt2)) return null;
    const badging = execFileSync(aapt2, ['dump', 'badging', APK], { encoding: 'utf8' });
    return Number((badging.match(/versionCode='(\d+)'/) || [])[1]);
};

(async () => {
    step(`YaapZone ${version} (versionCode ${versionCode})${mandatory ? ', mandatory' : ''}`);
    if (!fs.existsSync(APK)) fail(`No APK at ${APK}. Build it first.`);
    const built = apkVersionCode();
    if (built === null) console.log('  (android build tools not found: skipping the apk version check)');
    else if (built !== versionCode) fail(`The APK is versionCode ${built}, app.json says ${versionCode}. Rebuild the APK after the version bump.`);
    else console.log(`  the APK is versionCode ${built}: matches`);

    const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const asset = `yaapzone-${version}.apk`;
    const apkUrl = `https://github.com/${repo}/releases/download/v${version}/${asset}`;

    if (!skipUpload) {
        step(`Uploading to GitHub Release v${version} (${repo})`);
        const named = path.join(os.tmpdir(), asset);
        fs.copyFileSync(APK, named);
        execFileSync('gh', ['release', 'create', `v${version}`, named, '--title', `YaapZone ${version}`, '--notes', notes], { cwd: ROOT, stdio: 'inherit' });
        fs.unlinkSync(named);
    }

    step(`Publishing on ${apiUrl} (a sleeping Render server can take a minute to wake)`);
    const res = await fetch(`${apiUrl}/apiv1/app/releases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-release-key': key },
        body: JSON.stringify({ version, version_code: versionCode, apk_url: apkUrl, notes: notes.trim(), is_mandatory: mandatory }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) fail(`The server refused (${res.status}): ${body?.error || body?.message || 'no answer'}${skipUpload ? '' : '\n  The GitHub Release exists: fix the problem, then re-run with --skip-upload.'}`);
    console.log(`\nOK: YaapZone ${version} is published: ${apkUrl}`);
    console.log(`  "update available" was sent to ${body.data.notified_devices} phone(s); everyone else sees it at their next start.`);
})().catch((error) => fail(error.message));
