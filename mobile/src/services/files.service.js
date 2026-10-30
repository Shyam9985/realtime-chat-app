import { File, UploadType } from "expo-file-system";
import { upload, download, remove } from "../store/api.service";
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

// fetches the logged in user's current profile photo as a data uri;
// null means "no photo / fetch failed" — the caller falls back to initials
export async function getProfilePhoto() {
    try {
        const blob = await download("files/profile-photo");
        if (!(blob instanceof Blob) || !blob.size) return null;
        return await blobToDataUri(blob);
    } catch {
        return null;
    }
}

// another member's current photo as a data uri. the server answers "no photo" when they have none,
// when the account is inactive and when they have blocked the viewer; all of those return null here
export async function getUserPhoto(userId) {
    try {
        const blob = await download(`users/${userId}/photo`);
        if (!(blob instanceof Blob) || !blob.size) return null;
        return await blobToDataUri(blob);
    } catch {
        return null;
    }
}

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

// a group's photo as a data uri (members, and people who exited); null when it has none
export async function getGroupPhoto(conversationId) {
    try {
        const blob = await download(`conversations/${conversationId}/photo`);
        if (!(blob instanceof Blob) || !blob.size) return null;
        return await blobToDataUri(blob);
    } catch {
        return null;
    }
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

// the file itself is the raw request body (no FormData) so the server can
// read the byte stream directly; metadata travels in headers.
// file: a Blob; meta.name / meta.type fill in what a device Blob does not carry
export async function uploadFile(file, onProgress, meta = {}) {
    const name = meta.name || file.name || `profile-${Date.now()}.jpg`;
    const type = meta.type || file.type || "application/octet-stream";

    try {
        return await upload(
            "files/upload",
            file,
            {
                "Content-Type": type,
                "x-file-name": encodeURIComponent(name),
            },
            (event) => {
                // translate axios's byte counts into a plain percentage so
                // components never deal with transport details
                if (event.total) {
                    const pct = Math.round((event.loaded / event.total) * 100);
                    onProgress?.(pct);
                }
            }
        );
    } catch (error) {
        return error;
    }
}
