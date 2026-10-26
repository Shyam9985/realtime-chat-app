import { get } from "../store/api.service";

// Ported from the web client's services/profile.service.js
export async function getProfile() {
    try {
        const response = await get('profile');
        return response;
    } catch (error) {
        return error;
    }
}
