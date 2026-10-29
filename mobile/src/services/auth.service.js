import { post, get } from "../store/api.service";
import * as tokenStore from "../store/tokenStore";
import { unregisterPush } from "./push.service";
import * as keyStore from "../crypto/keyStore";

// Ported from the web client's services/auth.service.js: every function returns the server's
// envelope on success and the error object on failure, and never throws.

export async function handleLogin(formData) {
    let data = null;
    try {
        const response = await post('auth/login', formData);
        data = response;

    } catch (error) {
        data = error;
    }
    return data;
}

// creates the account; the server expects fst_nm / lst_nm / mobile / date_of_birth and rejects unknown fields.
// keys: the encryption keys made on this phone for the new account (keyStore.keysForSignUp)
export async function handleSignup(values, keys) {
    try {
        const body = { email: values.email.trim(), password: values.password, fst_nm: values.firstName.trim(), date_of_birth: values.dateOfBirth, keys };
        if (values.lastName?.trim()) body.lst_nm = values.lastName.trim();
        if (values.mobile?.trim()) body.mobile = values.mobile.trim();
        const response = await post('auth/signup', body);
        return response;
    } catch (error) {
        return error;
    }
}

export async function handleLogout() {
    try {
        const user = await tokenStore.getUser();
        // first, while still signed in: this phone stops receiving this user's notifications
        await unregisterPush();
        const response = await post('auth/logout', user ? JSON.stringify(user) : {});
        // the keys stay on the phone (a later forgotten password can be re-locked from here); this
        // session forgets them
        keyStore.forgetSession();
        return response;
    } catch (error) {
        return error;
    }
}

export async function sendForgotPasswordEmail(email) {
    try {
        const response = await post('/auth/forgot-password', { email: email });
        return response
    } catch (error) {
        return error;
    }
}

export async function verifyForgotPasswordOtp(body) {
    try {
        const response = await post('auth/email/verify-otp', { email: body.email, otp: body.otp, message_key: body.key });
        return response;
    } catch (error) {
        return error
    }

}

// the new password and, when this phone has the encryption key, the key backup locked with it (in
// one request, so both change together). without the key the server marks the old backup out of date
export async function updatePassword(body) {
    try {
        const keyBackup = await keyStore.passwordBackupFor(body.newPassword, body.email).catch(() => null);
        const response = await post('auth/update-password', {
            email: body.email,
            usedFor: body?.usedFor || 'forgot-password',
            newPassword: body.newPassword,
            otpKey: body.otpKey,
            ...(keyBackup ? { key_backup: keyBackup } : {})
        });
        return response;
    } catch (error) {
        return error;
    }
}

export async function resetPasswordMail() {
    try {
        const response = await get('auth/reset-password/send-email');
        return response;
    } catch (error) {
        return error;
    }
}
