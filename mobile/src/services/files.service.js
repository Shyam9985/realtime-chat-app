import { upload, download, remove } from "../store/api.service";

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

// admins: a new group photo (raw body, like the profile photo); the server compresses it and replaces the old one
export async function uploadGroupPhoto(conversationId, file, meta = {}) {
    try {
        return await upload(`conversations/${conversationId}/photo`, file, {
            "Content-Type": meta.type || file.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(meta.name || `group-${Date.now()}.jpg`),
        });
    } catch (error) {
        return error;
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
