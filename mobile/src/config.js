// EXPO_PUBLIC_* variables are inlined by Expo at build time (see mobile/.env.example).
// On a physical device replace localhost with the machine's LAN ip.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4200').replace(/\/+$/, '');
export const API_PREFIX = '/apiv1';
