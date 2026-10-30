import { get, patch } from "../store/api.service";
import axios from "../store/interceptor";
import * as keyStore from "../crypto/keyStore";
import { unregisterPush } from "./push.service";

// Ported from the web client's services/profile.service.js
export async function getProfile() {
    try {
        const response = await get('profile');
        return response;
    } catch (error) {
        return error;
    }
}

// the user's own details: { fst_nm?, lst_nm?, mobile?, date_of_birth? }; answers with the fresh profile
export async function updateProfile(changes) {
    try {
        const response = await patch('profile', changes);
        return response;
    } catch (error) {
        return error;
    }
}

// deletes the account and everything it wrote, for good. the password is asked again (the server checks
// it); afterwards this phone forgets the account's keys too. answers the server's envelope or error
export async function deleteAccount(password, userId) {
    try {
        await unregisterPush().catch(() => {});
        const response = await axios.delete('profile', { data: { password } });
        await keyStore.deleteLocalKeys(userId);
        return response;
    } catch (error) {
        return error;
    }
}
