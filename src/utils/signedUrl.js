const crypto = require('crypto');
const config = require('../config/env');

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

// Separate key derived from the JWT secret, used only for media links
const secret = () => `${config.jwt.accessSecret}:media`;

function signature(filename, exp) {
  return crypto.createHmac('sha256', secret()).update(`${filename}:${exp}`).digest('hex');
}

// Turns "/uploads/<file>" into a temporary link: "/api/media/<file>?exp=...&sig=..."
function signMediaUrl(storedUrl, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const filename = String(storedUrl).split('/').pop();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/media/${filename}?exp=${exp}&sig=${signature(filename, exp)}`;
}

function verifyMediaSignature(filename, exp, sig) {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum < Date.now() / 1000) return false;
  if (typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) return false;

  const expected = Buffer.from(signature(filename, expNum), 'hex');
  // Constant-time comparison prevents timing attacks
  return crypto.timingSafeEqual(expected, Buffer.from(sig, 'hex'));
}

module.exports = { signMediaUrl, verifyMediaSignature };