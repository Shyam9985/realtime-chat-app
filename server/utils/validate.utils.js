
const isRequired = (value) => {

    // undefined or null
    if (value === undefined || value === null) return false;

    // string
    if (typeof value === 'string' && value.trim() === '') return false;

    // array
    if (Array.isArray(value) && value.length === 0) return false;

    // object
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;

    // invalid number
    if (typeof value === 'number' && Number.isNaN(value)) return false;

    return true;
};

const isValidMobile = (mobile) => {
    mobile = String(mobile).trim();
    return /^[6-9]\d{9}$/.test(mobile);
};

const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];



const isValidEmail = (email) => {

    if (!email) return false;

    email = String(email).trim();

    const regex =
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

    if (!regex.test(email)) {
        return false;
    }

    if (email.length > 254) {
        return false;
    }

    const [localPart, domain] = email.split('@');

    if (localPart.length > 64) {
        return false;
    }

    if (localPart.startsWith('.')
        || localPart.endsWith('.')
        || localPart.includes('..')) {
        return false;
    }

    if (domain.includes('..')) {
        return false;
    }

    return true;
};

const isValidAlpha = (value) => {
    return /^[A-Za-z\s]+$/.test(String(value));
};

const isValidAlphaNumeric = (value) => {
    return /^[A-Za-z0-9\s]+$/.test(String(value));
};

const isValidNumber = (value, { min = null, max = null, label = 'Value' } = {}) => {

    if (value === '' || value === null || value === undefined || isNaN(value)) return { status: false, message: `${label} must be a valid number.` };

    value = Number(value);

    if (min !== null && value < min) return { status: false, message: `${label} should be greater than or equal to ${min}.` };
    if (max !== null && value > max) return { status: false, message: `${label} should be less than or equal to ${max}.` };

    return { status: true, message: null };
};

const isPositiveNumber = (value) => {
    return Number(value) > 0;
};

const isNonNegativeNumber = (value) => {
    return Number(value) >= 0;
};

const isValidDecimal = (value) => {
    return /^\d+(\.\d+)?$/.test(String(value));
};

const isValidLength = (value, min = 0, max = Infinity) => {
    const len = String(value).trim().length;
    return len >= min && len <= max;
};

const isValidDate = (date) => {
    const parsed = new Date(date);
    return parsed instanceof Date
        && !isNaN(parsed);
};

// returns the { status, message } shape expected by validateNode's boolean type check
const isValidBoolean = (value) => {
    return { status: typeof value === 'boolean', message: null };
};

const isValidPersonName = (name) => {
    return /^[A-Za-z.\s]{2,100}$/.test(
        String(name).trim()
    );
};

const isValidAmount = (amount) => {
    return Number.isFinite(Number(amount))
        && Number(amount) >= 0;
};

const isValidInteger = (value) => {
    return Number.isInteger(Number(value));
};

const isPositiveInteger = (value) => {
    return Number.isInteger(Number(value))
        && Number(value) > 0;
};

const isValidPincode = (pincode) => {
    return /^[1-9][0-9]{5}$/.test(
        String(pincode)
    );
};

const isValidGstin = (gstin) => {
    gstin = String(gstin).trim().toUpperCase();
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}$/.test(gstin);
};

const isStrongPassword = (password) => {

    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,20}$/
        .test(password);
};

const isValidEnum = (value, allowedValues = []) => {
    return allowedValues.includes(value);
};

const isValidString = (value, { minLength = 0, maxLength = Infinity, allowEmpty = false, trim = true, label = 'Value' } = {}
) => {

    if (typeof value !== 'string') return { status: false, message: `${label} must be a valid string.` };

    if (trim) { value = value.trim(); }
    if (!allowEmpty && value === '') return { status: false, message: `${label} cannot be empty.` };
    if (value.length < minLength) return { status: false, message: `${label} should contain minimum ${minLength} characters.` };
    if (value.length > maxLength) return { status: false, message: `${label} should contain maximum ${maxLength} characters.` };
    return { status: true, message: null };
};

const isValidArray = (value, { minItems = 0, maxItems = Infinity, allowEmpty = false, label = 'Value' } = {}) => {

    if (!Array.isArray(value)) return { status: false, message: `${label} must be a valid list.` };

    if (!allowEmpty && value.length === 0) return { status: false, message: `${label} cannot be empty.` };
    if (value.length < minItems) return { status: false, message: `${label} should contain minimum ${minItems} item(s).` };
    if (value.length > maxItems) return { status: false, message: `${label} should contain maximum ${maxItems} item(s).` };
    return { status: true, message: null };
};

const isValidObject = (value, { allowEmpty = false, minKeys = 0, maxKeys = Infinity, label = 'Value' } = {}) => {

    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { status: false, message: `${label} must be a valid object.` };

    const keyCount = Object.keys(value).length;

    if (!allowEmpty && keyCount === 0) return { status: false, message: `${label} cannot be empty.` };
    if (keyCount < minKeys) return { status: false, message: `${label} should contain minimum ${minKeys} properties.` };
    if (keyCount > maxKeys) return { status: false, message: `${label} should contain maximum ${maxKeys} properties.` };
    return { status: true, message: null };
};

const validateNode = (payload, schema, errors, strictMode = true, path = '') => {

    // validate payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        errors.push(`${path || 'payload'} contains invalid object.`);
        return;
    }

    // validate schema
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        errors.push(`${path || 'schema'} contains invalid schema.`);
        return;
    }

    const payloadKeys = Object.keys(payload);
    const schemaKeys = Object.keys(schema);

    // strict mode
    if (strictMode) {

        const extraFields = payloadKeys.filter(key => !schemaKeys.includes(key));

        if (extraFields.length) {
            extraFields.forEach(field => {
                const fieldPath = path ? `${path}.${field}` : field;
                errors.push(`${fieldPath} field is not allowed.`);
            });
            return;
        }

    }

    // field validations
    for (const field of schemaKeys) {

        const rules = schema[field];
        const value = payload[field];

        const currentPath = path ? `${path}.${field}` : field;
        // required validation
        if (rules?.required && !isRequired(value)) {
            errors.push(`${rules?.label || currentPath} is required.`); break;
        }

        // optional field
        if (!isRequired(value)) {
            continue;
        }

        // allowed values validation (applies to any type)
        if (rules?.enum?.length && !rules.enum.includes(value)) {
            errors.push(`${rules?.label || currentPath} must be one of: ${rules.enum.join(', ')}.`);
            break;
        }

        // string validation
        if (rules?.type === 'string') {

            const result = isValidString(value, { minLength: rules?.minLength, maxLength: rules?.maxLength, label: rules?.label || currentPath });

            if (!result.status) {
                errors.push(result.message);
                break;
            }
        }

        // email validation
        if (rules?.type === 'email') {

            if (!isValidEmail(value)) {
                errors.push(value + ' is not valid email.');
                break;
            }
        }

        // mobile no validation
        if (rules?.type === 'mobile-no') {

            if (!isValidMobile(value)) {
                errors.push(value + ' is not valid mobile number.');
                break;
            }
        }

        // aadhaar no validation

        // alpha validation
        if (rules?.type === 'alpha') {
            if (!isValidAlpha(value)) {
                errors.push(value + ' is not valid string.');
                break;
            }
        }

        // alph + numeric validation
        if (rules?.type === 'alpha-numeric') {
            if (!isValidAlphaNumeric(value)) {
                errors.push(value + ' is not valid string.');
                break;
            }
        }

        // password validation
        if (rules?.type === 'password') {
            if (!isStrongPassword(value)) {
                errors.push(value + ' is week, please check.');
                break;
            }
        }

        // number validation
        if (rules?.type === 'number') {

            const result = isValidNumber(value, { min: rules?.min, max: rules?.max, label: rules?.label || currentPath });
            if (!result.status) {
                errors.push(result.message);
                break;
            }
        }

        // boolean validation
        if (rules?.type === 'boolean') {

            const result = isValidBoolean(value);

            if (!result.status) {
                errors.push(result.message || `${rules?.label || currentPath} must be boolean.`);
                break;
            }
        }

        // array validation
        if (rules?.type === 'array') {

            const result = isValidArray(value, { minItems: rules?.minItems, maxItems: rules?.maxItems, allowEmpty: rules?.allowEmpty, label: rules?.label || currentPath });

            if (!result.status) {
                errors.push(result.message);
                break;
            }

            // recursive array item validation - each item is validated against itemSchema,
            // and its path carries the row index so a failure names the offending row
            if (rules?.itemSchema && Array.isArray(value))
                value.forEach((item, index) => { validateNode(item, rules.itemSchema, errors, strictMode, `${currentPath}[${index}]`); });
            continue;
        }

        // object validation
        if (rules?.type === 'object') {

            const result = isValidObject(value, { minKeys: rules?.minKeys, maxKeys: rules?.maxKeys, allowEmpty: rules?.allowEmpty, label: rules?.label || currentPath });
            if (!result.status) {
                errors.push(result.message);
                continue;
            }

            // recursive object validation
            if (rules?.schema) validateNode(value, rules.schema, errors, strictMode, currentPath);
            continue;
        }

        // enum validation
        if (Array.isArray(rules?.enum) && !rules.enum.includes(value)) {
            errors.push(`${rules?.label || currentPath} contains invalid value.`);
            break;
        }

        // custom validator
        if (typeof rules?.validator === 'function') {

            const result = rules.validator(value);

            if (result && typeof result === 'object') {

                if (!result.status) {
                    errors.push(result.message || `${rules?.label || currentPath} is invalid.`);
                    break;
                }
            }

            else if (result === false) {
                errors.push(`${rules?.label || currentPath} is invalid.`);
                break;
            }
        }
    }
};

const validatePayload = async (payload, schema, strictMode = true) => {

    const errors = [];

    try {

        // payload checks
        validateNode(payload, schema, errors, strictMode);
        if (errors.length) return { validationStatus: false, errors };
        return { validationStatus: true, errors: [] };

    } catch (error) {
        throw error;
    }
};

// positive integer id from a path param, query or body value; anything else is a validationFailed error
const parseId = (value, label = 'Id') => {
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (!Number.isInteger(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) {
        const error = new Error(`${label} must be a positive integer.`);
        error.name = 'validationFailed';
        throw error;
    }
    return n;
};

// mysql2 hands DATETIME columns back as Date objects; clients get ISO-8601 strings
const toIso = (value) => (value instanceof Date ? value.toISOString() : (value ?? null));

module.exports = {
    parseId,
    toIso,
    validatePayload,
    isRequired,
    isValidMobile,
    isValidEmail,
    isValidPincode,
    isValidPersonName,
    isValidInteger,
    isPositiveInteger,
    isValidAmount,
    isValidDate,
    isStrongPassword,
    isValidEnum,
    isValidGstin,
    isValidString,
    isValidNumber,
    isValidObject,
    isValidArray
};