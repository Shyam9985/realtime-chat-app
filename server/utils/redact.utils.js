/*
 * Hides sensitive values before anything is written to a log file or the
 * audit table. To hide a new field, add its exact key name to SENSITIVE_KEYS.
 */

// key names (lowercase) whose values are never logged
const SENSITIVE_KEYS = [
    'password', 'password_hash', 'password_txt', 'password_salt', 'pwd',
    'otp', 'token', 'access-token', 'new-access-token', 'refresh_token',
    'authorization', 'cookie', 'secret',
    // camelCase / other spellings used by the password routes
    'newpassword', 'new_password', 'oldpassword', 'old_password', 'confirmpassword', 'confirm_password', 'otpkey'
];

// returns a COPY with sensitive fields replaced by '[REDACTED]'. the original is not
// touched because req.body is still in use elsewhere when the logger runs
const redact = (value) => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(redact);

    const copy = {};
    for (const key in value) {
        copy[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '[REDACTED]' : redact(value[key]);
    }
    return copy;
};

// keeps a logged value small: anything bigger than maxChars (as JSON) is replaced by a note
const limitSize = (value, maxChars = 2000) => {
    const text = JSON.stringify(value) || '';
    return text.length > maxChars ? `[too large: ${text.length} chars]` : value;
};

module.exports = { redact, limitSize, SENSITIVE_KEYS };
