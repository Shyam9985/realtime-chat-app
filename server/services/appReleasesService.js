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

// GET /app/latest?version_code=10100  (versionCode parsed by appVldtr.validateLatest)
exports.latestSrvc = async (versionCode) => {
    log('in latestSrvc');
    const [latest] = await appReleasesMdl.getLatest();
    if (!latest || latest.version_code <= versionCode) return { latest: latest ? toDto(latest) : null, update_available: false, mandatory: false };
    return { latest: toDto(latest), update_available: true, mandatory: await appReleasesMdl.hasMandatoryAfter(versionCode) };
};

// ---- publishing (the release script on the developer's machine, with the release key)

// the request carries RELEASE_PUBLISH_KEY in x-release-key. without the setting publishing is off.
// compared in constant time, so the answer's timing says nothing about how close a guess was. the
// controller asks this first, so a caller without the key learns nothing about what a valid body is
exports.assertPublisherSrvc = (key) => {
    log('in assertPublisherSrvc');
    const expected = process.env.RELEASE_PUBLISH_KEY || '';
    const given = typeof key === 'string' ? key : '';
    const ok = expected.length >= 32 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) resutils.createError('notOwner', 'Not allowed to publish releases.');
};

// POST /app/releases: records the release and tells every registered phone "YaapZone x.y.z is available".
// release = { version, versionCode, apkUrl, notes, isMandatory }, as appVldtr.validateRelease returns it
exports.publishSrvc = async (release) => {
    log('in publishSrvc');
    const [latest] = await appReleasesMdl.getLatest();
    if (latest && latest.version_code >= release.versionCode) resutils.createError('validationFailed', `${release.version} is not newer than the latest release, ${latest.version}.`);

    try {
        await appReleasesMdl.insert(release);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') resutils.createError('validationFailed', `${release.version} is already published.`);
        throw error;
    }
    const [stored] = await appReleasesMdl.getLatest();
    // the push never fails the publish: the release is recorded, and the app finds it at its next start anyway
    const pushed = await pushService.announceRelease(stored)
        .catch((error) => { console.error('[push] could not announce the release:', error.message); return { sent: 0, failed: 0 }; });
    return { release: toDto(stored), notified_devices: pushed.sent };
};

exports.toDto = toDto;
