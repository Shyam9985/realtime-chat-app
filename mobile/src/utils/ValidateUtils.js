/*
 * Ported from the web client's utils/ValidateUtils.js (the validators the auth screens use).
 * Each returns { status, message }. The server applies the same rules
 * (server/utils/validate.utils.js), so a value that passes here is accepted there.
 */

// every validator answers with this shape so forms can read .status and .message
const success = () => ({ status: true, message: '' });
const failure = (message) => ({ status: false, message });

export const isValidMobile = (mobile, { label = 'Mobile number' } = {}) => {

    mobile = String(mobile).trim();

    if (mobile === '') {
        return failure(`${label} is required.`);
    }

    if (!/^\d+$/.test(mobile)) {
        return failure(`${label} should contain only digits.`);
    }

    if (mobile.length !== 10) {
        return failure(`${label} should contain exactly 10 digits.`);
    }

    if (!/^[6-9]/.test(mobile)) {
        return failure(`${label} should start with digits 6 to 9.`);
    }

    return success();
};

export const isValidEmail = (email, { label = 'Email address' } = {}) => {

    if (email === undefined || email === null) {
        return failure(`${label} is required.`);
    }

    email = String(email).trim();

    if (email === '') {
        return failure(`${label} cannot be empty.`);
    }

    if (email.length > 254) {
        return failure(`${label} cannot exceed 254 characters.`);
    }

    const regex =
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

    if (!regex.test(email)) {
        return failure(`Please enter a valid ${label.toLowerCase()}.`);
    }

    const [localPart, domain] = email.split('@');

    if (localPart.length > 64) {
        return failure(`The username part of the ${label.toLowerCase()} cannot exceed 64 characters.`);
    }

    if (localPart.startsWith('.')) {
        return failure(`${label} cannot start with a period (.).`);
    }

    if (localPart.endsWith('.')) {
        return failure(`${label} cannot end with a period (.).`);
    }

    if (localPart.includes('..')) {
        return failure(`${label} cannot contain consecutive periods.`);
    }

    if (domain.includes('..')) {
        return failure(`${label} contains an invalid domain.`);
    }

    return success();
};

export const isValidPersonName = (name, { label = 'Name', minLength = 2, maxLength = 100 } = {}) => {

    if (!name) {
        return failure(`${label} is required.`);
    }

    name = String(name).trim();

    if (name.length < minLength) {
        return failure(`${label} must contain at least ${minLength} characters.`);
    }

    if (name.length > maxLength) {
        return failure(`${label} cannot exceed ${maxLength} characters.`);
    }

    if (!/^[A-Za-z.\s]+$/.test(name)) {
        return failure(`${label} should contain only alphabets, spaces and periods.`);
    }

    return success();
};

export const isStrongPassword = (password, { label = 'Password', minLength = 8, maxLength = 20 } = {}) => {

    if (!password) {
        return failure(`${label} is required.`);
    }

    password = String(password);

    if (password.length < minLength) {
        return failure(`${label} must contain at least ${minLength} characters.`);
    }

    if (password.length > maxLength) {
        return failure(`${label} cannot exceed ${maxLength} characters.`);
    }

    if (!/[a-z]/.test(password)) {
        return failure(`${label} must contain at least one lowercase letter.`);
    }

    if (!/[A-Z]/.test(password)) {
        return failure(`${label} must contain at least one uppercase letter.`);
    }

    if (!/\d/.test(password)) {
        return failure(`${label} must contain at least one digit.`);
    }

    if (!/[@$!%*?&]/.test(password)) {
        return failure(`${label} must contain at least one special character (@$!%*?&).`);
    }

    return success();
};
