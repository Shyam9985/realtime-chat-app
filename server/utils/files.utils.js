const crypto = require("crypto");
const path = require("path");

// jpg and jpeg share one mime type; webp lives inside a RIFF container
const ALLOWED_IMAGE_TYPES = {
    "image/jpeg": { extensions: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] },
    "image/png": { extensions: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
    "image/webp": { extensions: [".webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB: the most a phone may upload
const MAX_STORED_PHOTO_BYTES = 1024 * 1024;  // 1 MB: the most a stored (compressed) photo may take

// where uploaded files live. UPLOADS_DIR can move them (e.g. onto a render persistent disk, since a
// free render instance loses its own disk on every deploy); by default server/uploads
const UPLOADS_ROOT = process.env.UPLOADS_DIR ? path.resolve(process.cwd(), process.env.UPLOADS_DIR) : path.join(__dirname, '../uploads');
const PROFILE_PHOTO_DIR = path.join(UPLOADS_ROOT, 'profile-photos');
const GROUP_PHOTO_DIR = path.join(UPLOADS_ROOT, 'group-photos');

// a stored file_path (relative to the uploads root, e.g. "profile-photos/ab12.jpg") as an absolute path.
// rows from before UPLOADS_DIR existed stored "uploads/..." relative to server/
const resolveStoredPath = (filePath) => path.join(UPLOADS_ROOT, String(filePath).replace(/^uploads[\\/]/, ''));
const toStoredPath = (absolutePath) => path.relative(UPLOADS_ROOT, absolutePath).replace(/\\/g, '/');

/*
 * A profile photo as stored: upright (the phone's rotation applied), at most 1080x1080, JPEG, and at most
 * 1 MB. The quality steps down until it fits; a rare photo still too big at the lowest quality is
 * shrunk further. Re-encoding also drops the hidden metadata (EXIF), including any GPS location.
 */
const compressProfilePhoto = async (inputPath) => {
    const sharp = require('sharp');
    for (const size of [1080, 720, 480]) {
        for (const quality of [82, 72, 62, 52, 42]) {
            const buffer = await sharp(inputPath).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality, mozjpeg: true }).toBuffer();
            if (buffer.length <= MAX_STORED_PHOTO_BYTES) return buffer;
        }
    }
    const error = new Error('This photo could not be made small enough. Please choose another one.');
    error.name = 'validationFailed';
    throw error;
};

// strips any path the client smuggled in (../../evil.jpg), control and reserved chars
const sanitizeFileName = (rawName = "") => {
    const baseName = path.basename(String(rawName).trim());
    return baseName.replace(/[\x00-\x1f<>:"/\\|?*]/g, "").slice(0, 200);
};

const getExtension = (fileName = "") => path.extname(fileName).toLowerCase();

// 16 random bytes -> 32 hex chars; collision odds are negligible in practice
const generateUniqueFileName = (extension) =>
    `${crypto.randomBytes(16).toString("hex")}${extension}`;

// a file's opening bytes identify its real format regardless of name or headers
const matchesMagicBytes = (fileBuffer, mimeType) => {
    const signatures = ALLOWED_IMAGE_TYPES[mimeType]?.magic || [];

    const matched = signatures.some((signature) =>
        signature.every((byte, index) => fileBuffer[index] === byte)
    );
    if (!matched) return false;

    // RIFF alone is not proof: avi/wav share it — bytes 8-11 must spell WEBP
    if (mimeType === "image/webp") {
        return fileBuffer.slice(8, 12).toString("ascii") === "WEBP";
    }

    return true;
};

const sha256 = (fileBuffer) => crypto.createHash("sha256").update(fileBuffer).digest("hex");

module.exports = {
    ALLOWED_IMAGE_TYPES,
    MAX_FILE_SIZE_BYTES,
    MAX_STORED_PHOTO_BYTES,
    UPLOADS_ROOT,
    PROFILE_PHOTO_DIR,
    GROUP_PHOTO_DIR,
    resolveStoredPath,
    toStoredPath,
    compressProfilePhoto,
    sanitizeFileName,
    getExtension,
    generateUniqueFileName,
    matchesMagicBytes,
    sha256,
};
