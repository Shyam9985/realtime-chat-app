const fs = require("fs");
const { pipeline } = require("stream/promises");
const resutils = require("../utils/response.utils");
const RESPONSE_STATUS = require("../utils/standard.messages");
const filesService = require("../services/filesService");
const fileutils = require("../utils/files.utils");
const { log } = require('../utils/log.utils');

// profile photos get their own corner of the uploads area (UPLOADS_DIR, see files.utils)
const PROFILE_PHOTO_DIR = fileutils.PROFILE_PHOTO_DIR;

// maps service/stream errors to http responses, mirroring settingsCtrl's pattern
const sendFilesError = (req, res, error, location) => {
  console.log(`Error in ${location} : `, error.message || error);

  if (res.headersSent) return; // stream errors can race the normal response

  if (error.name === "validationFailed") {
    return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.VALIDATION_ERROR, { function: location });
  }

  if (error.name === "noPhoto") {
    return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.NO_DATA_FOUND, { function: location });
  }

  return resutils.sendErrorResponse(req, res, error.message, RESPONSE_STATUS.INTERNAL_SERVER_ERROR, { function: location });
};

// streaming version: the raw request stream is handed to the service untouched;
// no chunk ever piles up here, the service pipes them straight to disk
exports.uploadFiles = async (req, res) => {
    log('in uploadFiles');
  // the body is the raw file itself, so metadata travels in headers
  const meta = {
    originalName: decodeURIComponent(req.headers["x-file-name"] || ""),
    mimeType: (req.headers["content-type"] || "").toLowerCase().split(";")[0].trim(),
    uploadedBy: req.user?.user_id || null,
  };

  log(`[upload] request received — name: '${meta.originalName}', mime: ${meta.mimeType}, user: ${meta.uploadedBy}`);

  // cheap early reject: the declared size alone already breaks the limit
  const declaredSize = Number(req.headers["content-length"] || 0);
  log(`[upload] declared content-length: ${declaredSize} bytes (cap ${fileutils.MAX_FILE_SIZE_BYTES})`);
  if (declaredSize > fileutils.MAX_FILE_SIZE_BYTES) {
    return sendFilesError(
      req,
      res,
      { name: "validationFailed", message: `File exceeds the ${fileutils.MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.` },
      "upload file controller",
    );
  }

  try {
    log("[upload] handing the request stream to filesService (no bytes read yet)");
    const result = await filesService.saveStreamedFileSrvc(req, meta, PROFILE_PHOTO_DIR);
    log(`[upload] done — file_id ${result.file_id}, stored at ${result.file_path}`);

    return resutils.sendSuccessResponse(
      req,
      res,
      result,
      {
        ...RESPONSE_STATUS.CREATED,
        message: `File saved at ${result.file_path} (${result.size_bytes} bytes).`,
      },
      { function: "upload file" },
    );
  } catch (error) {
    return sendFilesError(req, res, error, "upload file controller");
  }
};

// streams the logged in user's current profile photo back to the browser —
// the same pipeline mechanics as the upload, in the opposite direction
exports.getProfilePhoto = async (req, res) => {
    log('in getProfilePhoto');
  try {
    log(`[download] profile photo requested by user ${req.user?.user_id}`);
    const photo = await filesService.getProfilePhotoSrvc(req.user?.user_id);
    log(`[download] serving ${photo.absolutePath} (${photo.sizeBytes} bytes, ${photo.mimeType})`);

    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Content-Length", photo.sizeBytes);

    // disk -> res is the upload pipeline in reverse; res is a writable stream
    await pipeline(fs.createReadStream(photo.absolutePath), res);
    log("[download] stream to browser complete");
  } catch (error) {
    return sendFilesError(req, res, error, "get profile photo controller");
  }
};

// streams another member's current profile photo (GET /users/:id/photo)
exports.getUserPhoto = async (req, res) => {
  log('in getUserPhoto');
  try {
    const photo = await filesService.getUserPhotoSrvc(req.user?.user_id, req.params.id);
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Content-Length", photo.sizeBytes);
    await pipeline(fs.createReadStream(photo.absolutePath), res);
  } catch (error) {
    return sendFilesError(req, res, error, "get user photo controller");
  }
};
