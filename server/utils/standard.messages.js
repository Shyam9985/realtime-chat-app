const RESPONSE_STATUS = {

    SUCCESS: {
        code: 200,
        statusKey: "SUCCESS",
        message: "Request processed successfully."
    },

    CREATED: {
        code: 201,
        statusKey: "CREATED",
        message: "Resource created successfully."
    },

    UPDATED: {
        code: 200,
        statusKey: "UPDATED",
        message: "Resource updated successfully."
    },

    DELETED: {
        code: 200,
        statusKey: "DELETED",
        message: "Resource deleted successfully."
    },

    DATA_FOUND: {
        code: 200,
        statusKey: "DATA_FOUND",
        message: "Data retrieved successfully."
    },

    NO_DATA_FOUND: {
        code: 404,
        statusKey: "NO_DATA_FOUND",
        message: "No data found."
    },

    INVALID_REQUEST: {
        code: 400,
        statusKey: "INVALID_REQUEST",
        message: "Invalid request."
    },

    VALIDATION_ERROR: {
        code: 400,
        statusKey: "VALIDATION_ERROR",
        message: "Validation failed for request input data."
    },

    UNAUTHORIZED: {
        code: 401,
        statusKey: "UNAUTHORIZED",
        message: "Unauthorized access."
    },

    NO_SELECT_PERMISSION: {
        code: 403,
        statusKey: "NO_SELECT_PERMISSION",
        message: "You do not have permission to view this resource."
    },

    NO_INSERT_PERMISSION: {
        code: 403,
        statusKey: "NO_INSERT_PERMISSION",
        message: "You do not have permission to create this resource."
    },

    NO_UPDATE_PERMISSION: {
        code: 403,
        statusKey: "NO_UPDATE_PERMISSION",
        message: "You do not have permission to update this resource."
    },

    NO_DELETE_PERMISSION: {
        code: 403,
        statusKey: "NO_DELETE_PERMISSION",
        message: "You do not have permission to delete this resource."
    },

    FORBIDDEN: {
        code: 403,
        statusKey: "FORBIDDEN",
        message: "Access denied."
    },

    DUPLICATE_RECORD: {
        code: 409,
        statusKey: "DUPLICATE_RECORD",
        message: "Record already exists with the given details."
    },

    RECORD_IN_USE: {
        code: 409,
        statusKey: "RECORD_IN_USE",
        message: "Record is in use by other records and cannot be deleted."
    },

    NOT_FOUND: {
        code: 404,
        statusKey: "NOT_FOUND",
        message: "Requested resource not found."
    },

    DB_ERROR: {
        code: 500,
        statusKey: "DB_ERROR",
        message: "Database operation failed."
    },

    INVALID_DATA_FORMAT: {
        code: 400,
        statusKey: "INVALID_DATA_FORMAT",
        message: "Data sent in wrong format."
    },

    INVALID_DATA: {
        code: 400,
        statusKey: "INVALID_DATA",
        message: "Invalid data has been sent. Please check."
    },

    REQUIRED_FIELDS_MISSING: {
        code: 400,
        statusKey: "REQUIRED_FIELDS_MISSING",
        message: "Please fill the required fields/valid input data and try again."
    },

    UN_AUTH_ACCESS: {
        code: 401,
        statusKey: "UN_AUTH_ACCESS",
        message: "Unauthorized access/attempt. Please check and retry."
    },

    INVALID_OTP: {
        code: 401,
        statusKey: "INVALID_OTP",
        message: "Invalid/Expired OTP."
    },

    VALID_OTP: {
        code: 200,
        statusKey: "VALID_OTP",
        message: "OTP validated successfully."
    },

    INVALID_CREDENTIALS: {
        code: 401,
        statusKey: "INVALID_CREDENTIALS",
        message: "Invalid credentials. Please retry."
    },

    TEMPORARLY_LOCKED: {
        code: 423,
        statusKey: "TEMPORARLY_LOCKED",
        message: "Account is temporarily locked. Please try again later."
    },

    SESSION_ERR: {
        code: 500,
        statusKey: "SESSION_ERR",
        message: "Session database query/connection error."
    },

    TOOMANY_ATTEMPTS: {
        code: 429,
        statusKey: "TOOMANY_ATTEMPTS",
        message: "Too many wrong attempts. Please try after 24 hours or contact support."
    },

    TOOMANY_REQUESTS: {
        code: 429,
        statusKey: "TOOMANY_REQUESTS",
        message: "Too many requests. Please try after sometime."
    },

    SESSION_EXPIRED: {
        code: 401,
        statusKey: "SESSION_EXPIRED",
        message: "Session expired. Please login again."
    },

    INVALID_TOKEN: {
        code: 401,
        statusKey: "INVALID_TOKEN",
        message: "Invalid token sent. Please provide a valid token."
    },

    TOKEN_EXPIRED: {
        code: 401,
        statusKey: "TOKEN_EXPIRED",
        message: "Token expired. Please login again."
    },

    UNAUTHORISED_URL: {
        code: 401,
        statusKey: "UNAUTHORISED_URL",
        message: "Unauthorized URL. Access denied."
    },

    INTERNAL_SERVER_ERROR: {
        code: 500,
        statusKey: "INTERNAL_SERVER_ERROR",
        message: "Internal server error."
    },

    SERVICE_UNAVAILABLE: {
        code: 503,
        statusKey: "SERVICE_UNAVAILABLE",
        message: "Service temporarily unavailable."
    },

    DB_QUERY_ISSUE: {
        code: 500,
        statusKey: "DB_QUERY_ISSUE",
        message: "Database query/connection error."
    },

    MODEL_ERR: {
        code: 500,
        statusKey: "MODEL_ERR",
        message: "Something went wrong."
    },

    SYNTAX_ERROR: {
        code: 500,
        statusKey: "SYNTAX_ERROR",
        message: "Something went wrong. The error has been reported to the administrator."
    },

    UNABLE_TO_PROCESS: {
        code: 400,
        statusKey: "UNABLE_TO_PROCESS",
        message: "Unable to process request at the moment."
    },

    UNABLE_TO_SEND_EMAIL: {
        code: 500,
        statusKey: "UNABLE_TO_SEND_EMAIL",
        message: "Unable to send email. Please try again."
    },

    EMAIL_SENT: {
        code: 200,
        statusKey: "EMAIL_SENT",
        message: "Email sent successfully."
    },

    PASSWORD_UPDATED: {
        code: 200,
        statusKey: "PASSWORD_UPDATED",
        message: "Password updated successfully."
    },

    // ---- chat ----
    BLOCKED: {
        code: 403,
        statusKey: "BLOCKED",
        message: "You cannot send messages to this user."
    },

    NOT_A_MEMBER: {
        code: 403,
        statusKey: "NOT_A_MEMBER",
        message: "You are not a member of this conversation."
    },

    SELF_ACTION: {
        code: 400,
        statusKey: "SELF_ACTION",
        message: "You cannot perform this action on yourself."
    },

    DELETE_WINDOW_EXPIRED: {
        code: 403,
        statusKey: "DELETE_WINDOW_EXPIRED",
        message: "Messages can only be deleted for everyone within 15 minutes of sending."
    },
    EDIT_WINDOW_EXPIRED: {
        code: 403,
        statusKey: "EDIT_WINDOW_EXPIRED",
        message: "Messages can only be edited within 15 minutes of sending."
    },

    ACCOUNT_INACTIVE: {
        code: 403,
        statusKey: "ACCOUNT_INACTIVE",
        message: "This account is inactive."
    }

};

module.exports = RESPONSE_STATUS;