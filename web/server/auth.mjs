// Phone + OTP + MFA auth helpers for the dev BFF.
//
// Local development uses fixed codes (123456 OTP, 654321 MFA). Production swaps
// the send/verify steps for Supabase Auth + SMS gateway while keeping the same
// HTTP-only cookie seam.

import { lookupProfile } from './db.mjs';

const GOV_ROLES = new Set([
  'SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER',
  'SUPERINTENDING_ENGINEER', 'AUDITOR', 'HEAD_ADMIN',
]);

export const DEV_OTP = '123456';
export const DEV_MFA = '654321';

/** In-memory OTP challenge store (dev only — production uses Redis / Supabase). */
const pending = new Map();

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

export function issueOtpChallenge(phone, userId, requiresMfa) {
  const normalized = normalizePhone(phone);
  pending.set(normalized, {
    userId,
    requiresMfa,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return { maskedPhone: maskPhone(normalized), requiresMfa };
}

export function consumeOtpChallenge(phone) {
  const normalized = normalizePhone(phone);
  const hit = pending.get(normalized);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    pending.delete(normalized);
    return null;
  }
  pending.delete(normalized);
  return hit;
}

export function validateOtpCode(otp) {
  const code = String(otp ?? '').replace(/\D/g, '');
  // Dev/local fixed OTP; production replaces this with gateway verification.
  return code === DEV_OTP;
}

export function validateMfaCode(code) {
  return String(code ?? '').replace(/\D/g, '') === DEV_MFA;
}

export async function buildSession(userId) {
  const profile = await lookupProfile(userId);
  if (!profile) return null;
  const { id, ...rest } = profile;
  return { authenticated: true, userId: id, ...rest };
}
