const crypto = require("crypto");
const path = require("path");

// jpg and jpeg share one mime type; webp lives inside a RIFF container
const ALLOWED_IMAGE_TYPES = {
    "image/jpeg": { extensions: [".jpg", ".jpeg"], magic: [[0xff, 0xd8, 0xff]] },
    "image/png": { extensions: [".png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
    "image/webp": { extensions: [".webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
};

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

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
    sanitizeFileName,
    getExtension,
    generateUniqueFileName,
    matchesMagicBytes,
    sha256,
};
