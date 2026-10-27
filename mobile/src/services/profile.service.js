import { get, patch } from "../store/api.service";

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
