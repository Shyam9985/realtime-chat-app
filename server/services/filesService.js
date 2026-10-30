const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const resutils = require("../utils/response.utils");
const fileutils = require("../utils/files.utils");
const filesMdl = require("../models/filesMdl");
const usersMdl = require("../models/usersMdl");
const blocksMdl = require("../models/blocksMdl");
const { log } = require('../utils/log.utils');

// used when the caller does not specify a destination
const DEFAULT_UPLOAD_DIR = fileutils.PROFILE_PHOTO_DIR;

// builds a typed error that pipeline can carry out of the Transform stream
const validationError = (message) => {
    const error = new Error(message);
    error.name = "validationFailed";
    return error;
};

// how a profile photo is kept: it belongs to its uploader and replaces their previous one (row, the
// user's pointer and the old rows, in one transaction). a group photo passes its own target
const profileTarget = (meta) => ({
    entityType: "USER_PROFILE",
    entityId: meta.uploadedBy || null,
    persist: (record) => filesMdl.replaceProfilePhotoMdl(record),
});

// validates an uploaded image (up to 5 MB) and streams it to a temporary file; chunks flow
// request -> inspector -> disk, so memory never holds the whole upload. the photo actually kept is a
// compressed JPEG of at most 1 MB, and it replaces the previous photo completely (row and file).
// target: { entityType, entityId, persist(record) -> { fileId, oldPaths, ...anything else to return } }
exports.saveStreamedFileSrvc = async (readStream, meta, uploadDir = DEFAULT_UPLOAD_DIR, target = profileTarget(meta)) => {
    log('in saveStreamedFileSrvc');
    // meta: { originalName, mimeType, extension, uploadedBy }, the headers already checked by filesVldtr
    const { originalName, extension } = meta;

    await fs.promises.mkdir(uploadDir, { recursive: true });

    const storedName = fileutils.generateUniqueFileName(extension);
    const filePath = path.join(uploadDir, storedName);
    log(`[upload] crypto name generated, streaming to ${filePath}`);

    const hash = crypto.createHash("sha256");
    let receivedBytes = 0;
    let chunkCount = 0;
    let firstChunkChecked = false;

    // sits between the request and the disk: every chunk is inspected in flight
    const inspector = new Transform({
        transform(chunk, encoding, callback) {
            if (!firstChunkChecked) {
                firstChunkChecked = true;
                log(`[upload] first chunk arrived — magic bytes: ${chunk.slice(0, 4).toString("hex")}`);

                // the opening bytes must prove the claimed format — headers can lie
                if (!fileutils.matchesMagicBytes(chunk, meta.mimeType)) {
                    return callback(validationError("File content does not match the declared image type."));
                }
                log(`[upload] magic bytes match ${meta.mimeType} — continuing`);
            }

            receivedBytes += chunk.length;
            chunkCount += 1;
            log(`[upload] chunk ${chunkCount}: ${chunk.length} bytes (running total ${receivedBytes})`);

            // content-length can lie too — enforce the cap on actual received bytes
            if (receivedBytes > fileutils.MAX_FILE_SIZE_BYTES) {
                return callback(validationError(`File exceeds the ${fileutils.MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`));
            }

            hash.update(chunk);
            callback(null, chunk); // hand the chunk on to the disk write stream
        },
    });

    // the upload lands in a temporary file; only its compressed copy is kept
    const uploadPath = `${filePath}.upload`;
    const keptName = `${path.basename(storedName, extension)}.jpg`;
    const keptPath = path.join(uploadDir, keptName);
    try {
        // pipeline moves the chunks and owns backpressure: when the disk lags,
        // it pauses the request and resumes it once the write buffer drains
        await pipeline(readStream, inspector, fs.createWriteStream(uploadPath));
        log(`[upload] stream complete — ${receivedBytes} bytes in ${chunkCount} chunks, file is on disk`);

        if (!receivedBytes) {
            resutils.createError("validationFailed", "No file data received in the request body.");
        }
        log(`[upload] sha256 of the upload (built chunk by chunk): ${hash.digest("hex")}`);

        const photo = await fileutils.compressProfilePhoto(uploadPath);
        await fs.promises.writeFile(keptPath, photo);
        log(`[upload] compressed ${receivedBytes} -> ${photo.length} bytes (jpeg)`);

        const record = {
            original_nm: originalName,
            stored_nm: keptName,
            file_path: fileutils.toStoredPath(keptPath),
            extension: "jpg",
            mime_type: "image/jpeg",
            size_bytes: photo.length,
            checksum_sha256: fileutils.sha256(photo),
            entity_type: target.entityType,
            entity_id: target.entityId,
            uploaded_by: meta.uploadedBy || null,
        };

        // new row + the owner's pointer + the old rows removed, in one transaction; then the old files
        const { fileId, oldPaths, ...extra } = await target.persist(record);
        log(`[upload] db transaction committed — new photo ${fileId}, ${oldPaths.length} old one(s) replaced`);
        for (const oldPath of oldPaths) {
            await fs.promises.unlink(fileutils.resolveStoredPath(oldPath)).catch(() => {});   // already gone is fine
        }

        return { file_id: fileId, ...record, ...extra };
    } catch (error) {
        console.log(`[upload] FAILED (${error.message}) — removing the files of this attempt`);
        // never keep orphans: neither the upload nor a compressed copy of a failed attempt
        await fs.promises.unlink(keptPath).catch(() => {});
        throw error;
    } finally {
        await fs.promises.unlink(uploadPath).catch(() => {});
    }
};

// the user removes their profile photo: the rows and the user's pointer go in one transaction, then
// the files themselves are deleted from disk. no photo to remove answers noPhoto
exports.removeProfilePhotoSrvc = async (userId) => {
    log('in removeProfilePhotoSrvc');
    const { oldPaths } = await filesMdl.removeProfilePhotoMdl(userId);
    if (!oldPaths.length) resutils.createError("noPhoto", "No profile photo found.");
    for (const oldPath of oldPaths) {
        await fs.promises.unlink(fileutils.resolveStoredPath(oldPath)).catch(() => {});   // already gone is fine
    }
    log(`[photo] user ${userId} removed their photo (${oldPaths.length} file(s) deleted)`);
    return { removed: oldPaths.length };
};

// resolves a user's current profile photo to an absolute path for streaming back
exports.getProfilePhotoSrvc = async (user_id) => {
    log('in getProfilePhotoSrvc');
    const [photo] = await filesMdl.getActiveFileByEntityMdl("USER_PROFILE", user_id);
    if (!photo) {
        resutils.createError("noPhoto", "No profile photo found.");
    }

    // db rows can outlive files (manual deletes, disk moves) — verify before streaming
    const absolutePath = fileutils.resolveStoredPath(photo.file_path);
    try {
        await fs.promises.access(absolutePath);
    } catch {
        resutils.createError("noPhoto", "Profile photo file is missing on the server.");
    }

    return { absolutePath, mimeType: photo.mime_type, sizeBytes: photo.size_bytes };
};

// another member's photo for the viewer. an inactive account and a member who has blocked the viewer
// answer exactly like "no photo", so the response never reveals a block
exports.getUserPhotoSrvc = async (viewerId, userId) => {
    log('in getUserPhotoSrvc');
    const [user] = await usersMdl.getActiveUserById(userId);
    if (!user) resutils.createError("noPhoto", "No profile photo found.");
    if (userId !== Number(viewerId) && await blocksMdl.isSenderBlockedByRecipient(viewerId, userId)) {
        resutils.createError("noPhoto", "No profile photo found.");
    }
    return exports.getProfilePhotoSrvc(userId);
};
