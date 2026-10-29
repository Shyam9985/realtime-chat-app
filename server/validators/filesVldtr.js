const resutils = require('../utils/response.utils');
const fileutils = require('../utils/files.utils');
const { parseId } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

exports.userId = (value) => parseId(value, 'User id');

/*
 * POST /files/upload: the body is the raw file, so its metadata travels in headers. everything the
 * headers alone can prove is checked here (declared size, name, type, extension); the bytes themselves
 * (magic bytes, real size, empty body) can only be checked by filesService while they stream in.
 */
exports.validateUploadMeta = (headers = {}) => {
    log('in validateUploadMeta');
    // cheap early reject: the declared size alone already breaks the limit
    const declaredSize = Number(headers['content-length'] || 0);
    log(`[upload] declared content-length: ${declaredSize} bytes (cap ${fileutils.MAX_FILE_SIZE_BYTES})`);
    if (declaredSize > fileutils.MAX_FILE_SIZE_BYTES) {
        resutils.createError('validationFailed', `File exceeds the ${fileutils.MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`);
    }

    // a malformed percent-encoding is just an unusable name
    let rawName = '';
    try {
        rawName = decodeURIComponent(headers['x-file-name'] || '');
    } catch (_) {
        rawName = '';
    }
    const mimeType = (headers['content-type'] || '').toLowerCase().split(';')[0].trim();

    const originalName = fileutils.sanitizeFileName(rawName);
    if (!originalName) {
        resutils.createError('validationFailed', 'A valid file name is required (x-file-name header).');
    }

    const allowed = fileutils.ALLOWED_IMAGE_TYPES[mimeType];
    if (!allowed) {
        resutils.createError('validationFailed', `File type '${mimeType}' is not allowed. Allowed types: JPG, PNG, WEBP.`);
    }

    const extension = fileutils.getExtension(originalName);
    if (!allowed.extensions.includes(extension)) {
        resutils.createError('validationFailed', `Extension '${extension || 'none'}' does not match the file type '${mimeType}'.`);
    }

    log(`[upload] metadata valid — '${originalName}' (${mimeType}, ext ${extension})`);
    return { originalName, mimeType, extension };
};
