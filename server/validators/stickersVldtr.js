const resutils = require('../utils/response.utils');

/*
 * Request rules for stickers. Packs and stickers are referred to by id; the import takes a share link
 * of a public Signal sticker pack (the ids inside it are checked by signal.stickers.utils).
 */
const MAX_LINK_LENGTH = 600;

const id = (value, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) resutils.createError('validationFailed', `${label} must be a whole number from 1.`);
    return n;
};

exports.packId = (value) => id(value, 'pack id');
exports.stickerId = (value) => id(value, 'sticker id');

// POST /stickers/import and /stickers/packs  { link, is_default? }  (a Signal or Sticker.ly share link)
exports.validateImport = (body = {}) => {
    const link = typeof body.link === 'string' ? body.link.trim() : '';
    if (!link || link.length > MAX_LINK_LENGTH) resutils.createError('validationFailed', 'link is missing or too long.');
    if (body.is_default !== undefined && typeof body.is_default !== 'boolean') resutils.createError('validationFailed', 'is_default must be true or false.');
    return { link, isDefault: body.is_default === true };
};
