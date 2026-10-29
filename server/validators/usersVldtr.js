const resutils = require('../utils/response.utils');
const { parseId } = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

const MAX_SEARCH_TEXT = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

exports.userId = (value) => parseId(value, 'User id');

// GET /users?query=&limit=  - an empty query is allowed (it simply finds nobody); the limit is clamped
exports.validateSearch = (query = {}) => {
    log('in users validateSearch');
    const text = typeof query.query === 'string' ? query.query.trim() : '';
    if (text.length > MAX_SEARCH_TEXT) resutils.createError('validationFailed', 'Search text is too long.');
    let limit = Number.parseInt(query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    return { text, limit };
};
