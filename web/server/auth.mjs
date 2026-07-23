// Phone + OTP + MFA auth for the BFF.
//
// Codes are cryptographically random, stored only as HMAC-SHA256(pepper) hashes
// with a short TTL, single-use, and attempt-capped. Delivery goes through the
// pluggable provider seam. The fixed dev codes work ONLY when config.isDev, so
// they cannot authenticate in production.

import crypto from 'node:crypto';
import { lookupProfile } from './db.mjs';

const GOV_ROLES = new Set([
  'SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER',
  'SUPERINTENDING_ENGINEER', 'AUDITOR', 'HEAD_ADMIN',
]);

export const DEV_OTP = '123456';
export const DEV_MFA = '654321';

// key `${purpose}:${phone}` -> { userId, requiresMfa, hash, expiresAt, attempts }
const store = new Map();

export function __resetChallenges() { store.clear(); }

export function normalizePhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

export function maskPhone(phone) {
  if (phone.length < 4) return '**********';
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}

export async function findUserIdByPhone(pool, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const { rows } = await pool.query(
    `select id from eworks.user_profiles where phone = $1`,
    [normalized],
  );
  return rows[0]?.id ?? null;
}

/**
 * Look up a sign-in candidate by email.
 *
 * Returns the row even when password_hash is null (an account provisioned but
 * never given a password). The caller must still run verifyPassword against a
 * dummy hash in that case, so a passwordless account is not distinguishable
 * from a wrong password by response timing.
 */
export async function findUserByEmail(pool, email) {
  if (typeof email !== 'string' || !email.trim()) return null;
  const { rows } = await pool.query(
    `select id, email, phone, password_hash as "passwordHash", is_active as "isActive"
       from eworks.user_profiles
      where lower(email) = lower($1)`,
    [email.trim()],
  );
  return rows[0] ?? null;
}

export async function userRequiresMfa(pool, userId) {
  const { rows } = await pool.query(
    `select role_code from eworks.user_roles where user_id = $1`,
    [userId],
  );
  const codes = rows.map((r) => r.role_code);
  if (codes.length === 0) return false;
  const vendorOnly = codes.every((c) => c === 'LAB_VENDOR' || c === 'FIELD_TECHNICIAN');
  if (vendorOnly) return false;
  return codes.some((c) => GOV_ROLES.has(c));
}

export function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code, pepper) {
  return crypto.createHmac('sha256', pepper).update(String(code)).digest('hex');
}

const key = (purpose, phone) => `${purpose}:${phone}`;

export async function issueChallenge({
  phone, userId, requiresMfa = false, purpose = 'otp', config, provider,
}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const code = generateOtpCode();
  // Deliver first, store second: a failed send must not consume the caller's
  // budget or clobber a previously delivered, still-valid challenge.
  await provider.send({ phone: normalized, code, purpose });
  store.set(key(purpose, normalized), {
    userId,
    requiresMfa,
    hash: hashOtp(code, config.otpPepper),
    expiresAt: Date.now() + config.otpTtlMs,
    attempts: 0,
  });
  return {
    maskedPhone: maskPhone(normalized),
    requiresMfa,
    // Demo builds only (config.demoMode is hard-false in production): expose
    // the plaintext code so the UI can display it on screen.
    ...(config.demoMode ? { demoCode: code } : {}),
  };
}

export function verifyChallenge({ phone, code, purpose = 'otp', config }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, reason: 'invalid_phone' };
  const k = key(purpose, normalized);
  const hit = store.get(k);

  // Dev convenience only: the fixed codes never reach this branch in production,
  // and demo builds exclude them too — a demo must only accept the randomly
  // generated code it displays, never a universal skeleton code.
  if (config.isDev && !config.demoMode) {
    const fixed = purpose === 'mfa' ? DEV_MFA : DEV_OTP;
    if (String(code ?? '').replace(/\D/g, '') === fixed) {
      store.delete(k);
      return { ok: true, challenge: hit ?? { userId: null, requiresMfa: false } };
    }
  }

  if (!hit) return { ok: false, reason: 'no_challenge' };
  if (Date.now() > hit.expiresAt) { store.delete(k); return { ok: false, reason: 'expired' }; }
  if (hit.attempts >= config.otpMaxAttempts) {
    store.delete(k);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const provided = hashOtp(String(code ?? '').replace(/\D/g, ''), config.otpPepper);
  const match =
    provided.length === hit.hash.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(hit.hash));
  if (!match) {
    hit.attempts += 1;
    return { ok: false, reason: 'invalid_code' };
  }
  store.delete(k); // single use
  return { ok: true, challenge: hit };
}

export async function buildSession(userId) {
  const profile = await lookupProfile(userId);
  if (!profile) return null;
  const { id, ...rest } = profile;
  return { authenticated: true, userId: id, ...rest };
}
