// Password reset tokens.
//
// The token is the entire credential for a reset, so it is treated like one:
// 32 random bytes, stored only as an HMAC, single use, and short lived.
//
// Storing the hash rather than the token means a leaked database does not hand
// an attacker a working reset link — the same reason password_hash exists
// instead of a password column.

import crypto from 'node:crypto';

/** 30 minutes: long enough to find the email, short enough to limit exposure. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function generateResetToken() {
  // base64url so the token can go straight into a link without escaping.
  return crypto.randomBytes(32).toString('base64url');
}

export function hashResetToken(token, pepper) {
  return crypto.createHmac('sha256', pepper).update(String(token)).digest('hex');
}

/**
 * Fail closed: a missing expiry counts as expired rather than as "no limit",
 * so a malformed row cannot become an eternal reset link.
 */
export function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= now.getTime();
}
