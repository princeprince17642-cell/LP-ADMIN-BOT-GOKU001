'use strict';
// Token encryption (AES-256-GCM) and small crypto helpers.
// The key comes ONLY from the TOKEN_ENCRYPTION_KEY environment variable (64 hex characters).
const crypto = require('crypto');

function getKey() {
    const hex = String(process.env.TOKEN_ENCRYPTION_KEY || '').trim();
    return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

function isEncryptionReady() {
    return !!getKey();
}

function encrypt(plain) {
    const key = getKey();
    if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is missing or invalid');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
    const key = getKey();
    if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is missing or invalid');
    const parts = String(payload || '').split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted value');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const randomToken = (bytes) => crypto.randomBytes(bytes).toString('hex');

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { isEncryptionReady, encrypt, decrypt, sha256, randomToken, safeEqual };
