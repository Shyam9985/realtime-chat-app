/*
 * Raises the app version before a release build:
 *   npm run release:patch   bug fix    1.0.0 -> 1.0.1
 *   npm run release:minor   feature    1.0.1 -> 1.1.0
 *   npm run release:major   major      1.1.0 -> 2.0.0
 * app.json "version" is the one the user sees; android.versionCode is the whole number Android compares
 * (it must rise with every release, or a phone refuses the update). It is derived from the version as
 * major*10000 + minor*100 + patch, so it always rises as long as minor and patch stay below 100.
 * package.json's version follows, so both files always agree.
 */
const fs = require('fs');
const path = require('path');

const kind = process.argv[2];
if (!['patch', 'minor', 'major'].includes(kind)) {
    console.error('usage: node scripts/bump-version.js patch|minor|major');
    process.exit(1);
}

const appFile = path.join(__dirname, '..', 'app.json');
const pkgFile = path.join(__dirname, '..', 'package.json');
const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));

const [major, minor, patch] = app.expo.version.split('.').map(Number);
const next = kind === 'major' ? [major + 1, 0, 0] : kind === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1];
if (next[1] > 99 || next[2] > 99) {
    console.error(`${next.join('.')}: minor and patch must stay below 100 (versionCode would no longer rise). Make a major release instead.`);
    process.exit(1);
}
const version = next.join('.');
const versionCode = next[0] * 10000 + next[1] * 100 + next[2];

app.expo.version = version;
app.expo.android = { ...app.expo.android, versionCode };
pkg.version = version;
fs.writeFileSync(appFile, `${JSON.stringify(app, null, 2)}\n`);
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`YaapZone ${major}.${minor}.${patch} -> ${version} (android versionCode ${versionCode})`);
