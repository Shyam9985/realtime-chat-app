const RESPONSE_STATUS = require('./standard.messages');

/*
 * Maps the named errors thrown by the chat services (resutils.createError(name, message)) to the
 * standard response statuses. Shared by the REST controllers and the socket handlers so a
 * blocked send, for example, is reported with the same statusKey over both transports.
 */
const STATUS_BY_ERROR_NAME = {
    validationFailed: RESPONSE_STATUS.VALIDATION_ERROR,
    invalidCursor: RESPONSE_STATUS.VALIDATION_ERROR,
    userNotFound: RESPONSE_STATUS.NOT_FOUND,
    conversationNotFound: RESPONSE_STATUS.NOT_FOUND,
    messageNotFound: RESPONSE_STATUS.NOT_FOUND,
    notMember: RESPONSE_STATUS.NOT_A_MEMBER,
    blocked: RESPONSE_STATUS.BLOCKED,
    selfAction: RESPONSE_STATUS.SELF_ACTION,
    notOwner: RESPONSE_STATUS.FORBIDDEN,
    deleteWindowExpired: RESPONSE_STATUS.DELETE_WINDOW_EXPIRED,
    editWindowExpired: RESPONSE_STATUS.EDIT_WINDOW_EXPIRED,
    notEditable: RESPONSE_STATUS.FORBIDDEN,
    scheduledNotFound: RESPONSE_STATUS.NOT_FOUND,
    scheduledNotPending: RESPONSE_STATUS.VALIDATION_ERROR,
    notAdmin: RESPONSE_STATUS.NOT_GROUP_ADMIN,
    groupFull: RESPONSE_STATUS.GROUP_FULL,
    lastAdmin: RESPONSE_STATUS.LAST_ADMIN,
    notGroup: RESPONSE_STATUS.VALIDATION_ERROR,
    stillMember: RESPONSE_STATUS.VALIDATION_ERROR,
    accountInactive: RESPONSE_STATUS.ACCOUNT_INACTIVE,
    rateLimited: RESPONSE_STATUS.TOOMANY_REQUESTS,
    keyOutdated: RESPONSE_STATUS.KEY_OUTDATED,
    keyConflict: RESPONSE_STATUS.KEY_OUTDATED,
    keysMismatch: RESPONSE_STATUS.KEYS_MISMATCH,
    noKeys: RESPONSE_STATUS.NO_KEYS,
    noPhoto: RESPONSE_STATUS.NO_DATA_FOUND,
    DatabaseError: RESPONSE_STATUS.DB_ERROR,
};

const statusForError = (error) => STATUS_BY_ERROR_NAME[error?.name] || RESPONSE_STATUS.INTERNAL_SERVER_ERROR;

// the text the client may see. internal failures get the status' generic message, never error.message
const clientMessageForError = (error) => {
    const known = STATUS_BY_ERROR_NAME[error?.name];
    if (!known || error.name === 'DatabaseError') return statusForError(error).message;
    return error.message || known.message;
};

module.exports = { statusForError, clientMessageForError };
