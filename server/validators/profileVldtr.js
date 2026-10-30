const resutils = require('../utils/response.utils');
const validutils = require('../utils/validate.utils');
const { log } = require('../utils/log.utils');

/*
 * PATCH /profile  { fst_nm?, lst_nm?, mobile?, date_of_birth? }  - the same rules as sign-up; a blank
 * last name or mobile clears it, the first name and the date of birth cannot be cleared. the email (the
 * login id) is not editable, so it is an unknown field here. returns the changed columns, ready to store
 */
exports.validateUpdate = async (body = {}) => {
    log('in profile validateUpdate');
    const validation = await validutils.validatePayload(body, {
        fst_nm: { required: false, type: 'alpha', maxLength: 100, label: 'First Name' },
        lst_nm: { required: false, type: 'alpha', maxLength: 100, label: 'Last Name' },
        mobile: { required: false, type: 'mobile-no', label: 'Mobile Number' },
        date_of_birth: { required: false, type: 'string', label: 'Date of birth', validator: (value) => validutils.isValidBirthDate(value) }
    });
    if (!validation?.validationStatus) resutils.createError('validationFailed', validation.errors[0]);

    const fields = {};
    if (body.fst_nm !== undefined) {
        const first = String(body.fst_nm ?? '').trim();
        if (first.length < 2 || first.length > 100) resutils.createError('validationFailed', 'First name must be 2 to 100 letters.');
        fields.first_nm = first;
    }
    if (body.lst_nm !== undefined) {
        const last = String(body.lst_nm ?? '').trim();
        if (last.length > 100) resutils.createError('validationFailed', 'Last name cannot exceed 100 letters.');
        fields.last_nm = last || null;
    }
    if (body.mobile !== undefined) fields.mobile_no = String(body.mobile ?? '').trim() || null;
    if (body.date_of_birth !== undefined) {
        if (!String(body.date_of_birth ?? '').trim()) resutils.createError('validationFailed', 'Date of birth is required.');
        fields.date_of_birth = body.date_of_birth.trim();
    }
    if (!Object.keys(fields).length) resutils.createError('validationFailed', 'Nothing to change.');
    return fields;
};

// DELETE /profile  { password }  - the account is deleted only with the password typed again
exports.validateDeleteAccount = (body = {}) => {
    log('in profile validateDeleteAccount');
    if (typeof body.password !== 'string' || !body.password) resutils.createError('validationFailed', 'Enter your password to delete your account.');
    return { password: body.password };
};
