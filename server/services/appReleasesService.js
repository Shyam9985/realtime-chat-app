const crypto = require('crypto');
const appReleasesMdl = require('../models/appReleasesMdl');
const pushService = require('./pushService');
const resutils = require('../utils/response.utils');
const { toIso } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * App updates outside the Play Store. Every published APK is a row in app_releases_t; the app sends
 * its own versionCode at start and learns whether a newer build exists, where to download it, and
 * whether it must update before going on (any newer release marked mandatory, even a skipped one).
 */
const toDto = (row) => ({
    version: row.version,
    version_code: row.version_code,
    apk_url: row.apk_url,
    notes: row.notes,
    is_mandatory: !!row.is_mandatory,
    released_at: toIso(row.released_at),
});

// GET /app/latest?version_code=10100
exports.latestSrvc = async (versionCodeRaw) => {
    log('in latestSrvc');
    const versionCode = Number.parseInt(versionCodeRaw, 10);
    if (!Number.isInteger(versionCode) || versionCode < 0) resutils.createError('validationFailed', 'version_code must be a whole number.');
    const [latest] = await appReleasesMdl.getLatest();
    if (!latest || latest.version_code <= versionCode) return { latest: latest ? toDto(latest) : null, update_available: false, mandatory: false };
    return { latest: toDto(latest), update_available: true, mandatory: await appReleasesMdl.hasMandatoryAfter(versionCode) };
};

// ---- publishing (the release script on the developer's machine, with the release key)

const SEMVER = /^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/;

// the request carries RELEASE_PUBLISH_KEY in x-release-key. without the setting publishing is off.
// compared in constant time, so the answer's timing says nothing about how close a guess was
const assertPublisher = (key) => {
    const expected = process.env.RELEASE_PUBLISH_KEY || '';
    const given = typeof key === 'string' ? key : '';
    const ok = expected.length >= 32 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) resutils.createError('notOwner', 'Not allowed to publish releases.');
};

// POST /app/releases  { version, version_code, apk_url, notes?, is_mandatory? }: records the release and
// tells every registered phone "YaapZone x.y.z is available"
exports.publishSrvc = async (releaseKey, body = {}) => {
    log('in publishSrvc');
    assertPublisher(releaseKey);
    const match = typeof body.version === 'string' ? SEMVER.exec(body.version) : null;
    if (!match) resutils.createError('validationFailed', 'version must look like 1.2.3.');
    const [major, minor, patch] = match.slice(1).map(Number);
    const versionCode = major * 10000 + minor * 100 + patch;
    // the same rule as mobile/scripts/bump-version.js, so the row always matches the build
    if (body.version_code !== versionCode) resutils.createError('validationFailed', `version_code must be ${versionCode} for ${body.version}.`);
    if (typeof body.apk_url !== 'string' || !/^https:\/\/\S+$/.test(body.apk_url) || body.apk_url.length > 500) resutils.createError('validationFailed', 'apk_url must be an https link.');
    if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 2000)) resutils.createError('validationFailed', 'notes must be text up to 2000 characters.');
    if (body.is_mandatory !== undefined && typeof body.is_mandatory !== 'boolean') resutils.createError('validationFailed', 'is_mandatory must be true or false.');
    const [latest] = await appReleasesMdl.getLatest();
    if (latest && latest.version_code >= versionCode) resutils.createError('validationFailed', `${body.version} is not newer than the latest release, ${latest.version}.`);

    try {
        await appReleasesMdl.insert({ version: body.version, versionCode, apkUrl: body.apk_url, notes: body.notes?.trim(), isMandatory: !!body.is_mandatory });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') resutils.createError('validationFailed', `${body.version} is already published.`);
        throw error;
    }
    const [release] = await appReleasesMdl.getLatest();
    // the push never fails the publish: the release is recorded, and the app finds it at its next start anyway
    const pushed = await pushService.sendToAllDevices({
        type: 'update', version: release.version, mandatory: release.is_mandatory ? '1' : '0',
        title: `YaapZone ${release.version} is available`,
        body: release.is_mandatory ? 'This update is required. Tap to install it.' : 'Tap to see what’s new and update.',
    }).catch((error) => { console.error('[push] could not announce the release:', error.message); return { sent: 0, failed: 0 }; });
    return { release: toDto(release), notified_devices: pushed.sent };
};

exports.toDto = toDto;
