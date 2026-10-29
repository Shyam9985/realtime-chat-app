const resutils = require('../utils/response.utils');
const { log } = require('../utils/log.utils');

const SEMVER = /^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/;

// GET /app/latest?version_code=10100
exports.validateLatest = (query = {}) => {
    log('in app validateLatest');
    const versionCode = Number.parseInt(query.version_code, 10);
    if (!Number.isInteger(versionCode) || versionCode < 0) resutils.createError('validationFailed', 'version_code must be a whole number.');
    return { versionCode };
};

// POST /app/releases  { version, version_code, apk_url, notes?, is_mandatory? }
exports.validateRelease = (body = {}) => {
    log('in app validateRelease');
    const match = typeof body.version === 'string' ? SEMVER.exec(body.version) : null;
    if (!match) resutils.createError('validationFailed', 'version must look like 1.2.3.');
    const [major, minor, patch] = match.slice(1).map(Number);
    const versionCode = major * 10000 + minor * 100 + patch;
    // the same rule as mobile/scripts/bump-version.js, so the row always matches the build
    if (body.version_code !== versionCode) resutils.createError('validationFailed', `version_code must be ${versionCode} for ${body.version}.`);
    if (typeof body.apk_url !== 'string' || !/^https:\/\/\S+$/.test(body.apk_url) || body.apk_url.length > 500) resutils.createError('validationFailed', 'apk_url must be an https link.');
    if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 2000)) resutils.createError('validationFailed', 'notes must be text up to 2000 characters.');
    if (body.is_mandatory !== undefined && typeof body.is_mandatory !== 'boolean') resutils.createError('validationFailed', 'is_mandatory must be true or false.');
    return { version: body.version, versionCode, apkUrl: body.apk_url, notes: body.notes?.trim(), isMandatory: !!body.is_mandatory };
};
