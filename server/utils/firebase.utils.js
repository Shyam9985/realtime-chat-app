const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

/*
 * Firebase Cloud Messaging for the server. The service-account key (a secret) is a file whose path is
 * in FIREBASE_SERVICE_ACCOUNT_FILE: on a developer's machine the downloaded file in the repo root
 * (git-ignored), on Render a Secret File (/etc/secrets/...). Without it push is simply switched off
 * and everything else works as before.
 */
let messaging;          // undefined: not tried yet; null: switched off

const getFirebaseMessaging = () => {
    if (messaging !== undefined) return messaging;
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
    if (!file) {
        console.log('[push] FIREBASE_SERVICE_ACCOUNT_FILE is not set: push notifications are off');
        return (messaging = null);
    }
    try {
        const key = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
        initializeApp({ credential: cert(key) });
        messaging = getMessaging();
        console.log(`[push] firebase ready for project ${key.project_id}`);
    } catch (error) {
        // console.error, not log(): a broken key must be visible even with SHOW_LOG off. never print the key
        console.error('[push] could not load the firebase key, push notifications are off:', error.message);
        messaging = null;
    }
    return messaging;
};

module.exports = { getFirebaseMessaging };
