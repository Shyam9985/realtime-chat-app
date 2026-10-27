import axios from "axios";
import * as tokenStore from "./tokenStore";
import { API_URL, API_PREFIX } from "../config";

const axiosInstance = axios.create({
    baseURL: API_URL + API_PREFIX + '/',
    headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
    },
    sensitiveHeaders: ["access-token",],
    maxBodyLength: 100 * 1024 * 1024, // 100 MB
    maxContentLength: 100 * 1024 * 1024, // 100 MB
    withCredentials: true,
    parseReviver: (key, value) => {
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
            return new Date(value);
        }
        return value;
    },
    timeout: 30000, // 30 seconds
});

let logoutHandler = null;

export function registerLogoutHandler(handler) {
    logoutHandler = handler;
}

function handleLogout() {
    if (logoutHandler) {
        logoutHandler();
    }
}

// base64url -> text; atob is global on hermes and in the browser build
function decodeBase64Url(text) {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return globalThis.atob(padded);
}

// Reads the issued-at claim of a JWT. Returns 0 for missing/malformed tokens
// so any valid token always wins against "no token".
function tokenIat(token) {
    try {
        return JSON.parse(decodeBase64Url(token.split(".")[1])).iat || 0;
    } catch (error) {
        return 0;
    }
}

axiosInstance.interceptors.request.use(async (config) => {
    // add authentication token to headers
    const token = await tokenStore.getToken();

    if (token) {
        config.headers['access-token'] = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

axiosInstance.interceptors.response.use(

    async (response) => {
        // Set jwt token in secure storage
        const jwtToken = response.headers['access-token'];

        const localToken = await tokenStore.getToken();

        // Only ever replace the stored token with a strictly NEWER one.
        if (jwtToken && tokenIat(jwtToken) > tokenIat(localToken)) {
            await tokenStore.setToken(jwtToken);
        }

        // Refresh access token if server issued a new one
        const refreshToken = response.headers["new-access-token"];

        if (refreshToken && tokenIat(refreshToken) > tokenIat(localToken)) {
            await tokenStore.setToken(refreshToken);
        }
        return response.data;
    },
    async (error) => {

        // Network / CORS / Server unreachable
        if (!error.response) {
            return Promise.reject({
                success: false,
                code: 0,
                statusKey: "NETWORK_ERROR",
                message: "Unable to connect to the server.",
                error: error.message
            });
        }

        const { data } = error.response;

        switch (data?.statusKey) {
            case "TOKEN_EXPIRED":
            case "SESSION_EXPIRED":
                // Clear authentication data
                await tokenStore.clearToken();
                handleLogout();
                break;

            default:
                // Let the calling component handle it
                break;
        }

        return Promise.reject(data);
    }
);

export default axiosInstance;
