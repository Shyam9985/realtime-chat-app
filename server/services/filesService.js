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
const { parseId } = require("../utils/validate.utils");
const { log } = require('../utils/log.utils');

// used when the caller does not specify a destination
const DEFAULT_UPLOAD_DIR = path.join(__dirname, "../uploads");

// builds a typed error that pipeline can carry out of the Transform stream
const validationError = (message) => {
    const error = new Error(message);
    error.name = "validationFailed";
    return error;
};

// validates an uploaded image and streams it to disk under a crypto-random name;
// chunks flow request -> inspector -> disk, so memory never holds the whole file
exports.saveStreamedFileSrvc = async (readStream, meta, uploadDir = DEFAULT_UPLOAD_DIR) => {
    log('in saveStreamedFileSrvc');
    // metadata checks need no bytes — fail before touching the stream or the disk
    const originalName = fileutils.sanitizeFileName(meta.originalName);
    if (!originalName) {
        resutils.createError("validationFailed", "A valid file name is required (x-file-name header).");
    }

    const allowed = fileutils.ALLOWED_IMAGE_TYPES[meta.mimeType];
    if (!allowed) {
        resutils.createError("validationFailed", `File type '${meta.mimeType}' is not allowed. Allowed types: JPG, PNG, WEBP.`);
    }

    const extension = fileutils.getExtension(originalName);
    if (!allowed.extensions.includes(extension)) {
        resutils.createError("validationFailed", `Extension '${extension || "none"}' does not match the file type '${meta.mimeType}'.`);
    }

    log(`[upload] metadata valid — '${originalName}' (${meta.mimeType}, ext ${extension})`);

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

    try {
        // pipeline moves the chunks and owns backpressure: when the disk lags,
        // it pauses the request and resumes it once the write buffer drains
        await pipeline(readStream, inspector, fs.createWriteStream(filePath));
        log(`[upload] stream complete — ${receivedBytes} bytes in ${chunkCount} chunks, file is on disk`);

        if (!receivedBytes) {
            resutils.createError("validationFailed", "No file data received in the request body.");
        }

        const record = {
            original_nm: originalName,
            stored_nm: storedName,
            file_path: path.relative(path.join(__dirname, ".."), filePath).replace(/\\/g, "/"),
            extension: extension.slice(1),
            mime_type: meta.mimeType,
            size_bytes: receivedBytes,
            checksum_sha256: hash.digest("hex"),
            entity_type: "USER_PROFILE",
            entity_id: meta.uploadedBy || null, // a profile photo belongs to its uploader
            uploaded_by: meta.uploadedBy || null,
        };

        log(`[upload] sha256 (built chunk by chunk): ${record.checksum_sha256}`);

        // history row + user's current-photo pointer land in one transaction
        const [insertResult] = await filesMdl.insertProfilePhotoMdl(record);
        log(`[upload] db transaction committed — history row + users_lst_t.profile_photo_url`);

        return { file_id: insertResult.insertId, ...record };
    } catch (error) {
        console.log(`[upload] FAILED (${error.message}) — removing partial file from disk`);

        // any failure from here on can leave a partial file behind — never keep orphans
        await fs.promises.unlink(filePath).catch(() => {});
        throw error;
    }
};

// resolves a user's current profile photo to an absolute path for streaming back
exports.getProfilePhotoSrvc = async (user_id) => {
    log('in getProfilePhotoSrvc');
    const [photo] = await filesMdl.getActiveFileByEntityMdl("USER_PROFILE", user_id);
    if (!photo) {
        resutils.createError("noPhoto", "No profile photo found.");
    }

    // db rows can outlive files (manual deletes, disk moves) — verify before streaming
    const absolutePath = path.join(__dirname, "..", photo.file_path);
    try {
        await fs.promises.access(absolutePath);
    } catch {
        resutils.createError("noPhoto", "Profile photo file is missing on the server.");
    }

    return { absolutePath, mimeType: photo.mime_type, sizeBytes: photo.size_bytes };
};

// another member's photo for the viewer. an inactive account and a member who has blocked the viewer
// answer exactly like "no photo", so the response never reveals a block
exports.getUserPhotoSrvc = async (viewerId, userIdRaw) => {
    log('in getUserPhotoSrvc');
    const userId = parseId(userIdRaw, "User id");
    const [user] = await usersMdl.getActiveUserById(userId);
    if (!user) resutils.createError("noPhoto", "No profile photo found.");
    if (userId !== Number(viewerId) && await blocksMdl.isSenderBlockedByRecipient(viewerId, userId)) {
        resutils.createError("noPhoto", "No profile photo found.");
    }
    return exports.getProfilePhotoSrvc(userId);
};
