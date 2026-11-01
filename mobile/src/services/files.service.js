import { File, UploadType } from "expo-file-system";
import { download, remove } from "../store/api.service";
import * as tokenStore from "../store/tokenStore";
import { API_URL, API_PREFIX } from "../config";

// Ported from the web client's services/files.service.js. One adaptation: a device has no
// URL.createObjectURL, so the downloaded photo is handed back as a data uri instead of a Blob.

const blobToDataUri = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

// any stored image the server serves (a photo route) as a data uri; null means "no photo", whatever
// the reason (none set, an inactive account, a block, a failed fetch): the caller shows initials
async function fetchImage(path) {
    try {
        const blob = await download(path);
        if (!(blob instanceof Blob) || !blob.size) return null;
        return await blobToDataUri(blob);
    } catch {
        return null;
    }
}

// the logged in user's current profile photo
export const getProfilePhoto = () => fetchImage("files/profile-photo");
// another member's current photo (the server answers "no photo" when they blocked the viewer)
export const getUserPhoto = (userId) => fetchImage(`users/${userId}/photo`);
// a group's photo (members, and people who exited)
export const getGroupPhoto = (conversationId) => fetchImage(`conversations/${conversationId}/photo`);

/*
 * A picked photo, uploaded straight from its file on the phone as the raw request body (the server
 * reads the bytes as they stream in). The native upload of expo-file-system is used, not fetch(uri)
 * + axios: on this Expo version reading a picked file:// through fetch gives a few bytes of text
 * ("File ...") instead of the image, and the server rightly refuses that. Answers the server's envelope
 * (success or error), like the other services here.
 */
export async function uploadPickedPhoto(path, uri, { name, type }) {
    try {
        const token = await tokenStore.getToken();
        const result = await new File(uri).upload(`${API_URL}${API_PREFIX}/${path}`, {
            httpMethod: "POST",
            uploadType: UploadType.BINARY_CONTENT,
            headers: { "Content-Type": type, "x-file-name": encodeURIComponent(name), ...(token ? { "access-token": `Bearer ${token}` } : {}) },
        });
        // a refreshed token comes back on uploads too (the interceptor does this for every other call)
        const refreshed = result.headers?.["new-access-token"] || result.headers?.["New-Access-Token"];
        if (refreshed) await tokenStore.setToken(refreshed.replace(/^Bearer /, ""));
        try { return JSON.parse(result.body); } catch { return { success: false, message: "Unexpected answer from the server." }; }
    } catch (error) {
        return { success: false, message: error?.message || "Could not upload the photo." };
    }
}

// the size of a picked file in bytes (0 when it cannot be read)
export const pickedFileSize = (asset) => {
    try { return asset?.fileSize || new File(asset.uri).size || 0; } catch { return asset?.fileSize || 0; }
};

// the real type of a picked image. with cropping on, the picker saves the result as a new file (a JPEG,
// whatever the original was) but still reports the original's type: the server checks the bytes and
// refuses that mismatch. so the file's own extension decides, then the blob's type, then the picker's
const EXTENSION_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export function pickedImageType(asset, blob) {
    const extension = String(asset?.uri || "").split(/[?#]/)[0].split(".").pop().toLowerCase();
    return EXTENSION_TYPES[extension] || (blob?.type || asset?.mimeType || "").toLowerCase();
}

// admins: the group photo removed (row and file)
export async function removeGroupPhoto(conversationId) {
    try {
        return await remove(`conversations/${conversationId}/photo`);
    } catch (error) {
        return error;
    }
}

// removes the logged in user's photo; the server deletes the file too. answers the api response
export async function removeProfilePhoto() {
    try {
        return await remove("files/profile-photo");
    } catch (error) {
        return error;
    }
}
