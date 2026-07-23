// Password hashing for email + password sign-in.
//
// scrypt from node:crypto rather than bcrypt/argon2: it is a memory-hard KDF
// built into the runtime, so there is no native dependency to compile or keep
// patched on the deploy box.
//
// The cost parameters are encoded into every stored hash. That is what makes
// them raisable later — a future login can verify an old row at its original
// cost and transparently re-hash at the new one, without a flag day.

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

/** OWASP's floor for scrypt at the time of writing. */
const N = 16384; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEY_LEN = 32;
const SALT_LEN = 16;

export const PASSWORD_MIN_LENGTH = 10;

/**
 * A real scrypt hash of an unguessable random value, computed once at boot.
 *
 * The login route verifies against this when no account matches, so the
 * "no such email" path burns the same CPU as the "wrong password" path. Without
 * it, an attacker can tell registered addresses from unregistered ones by
 * response time alone, turning login into an account enumeration oracle.
 */
export const DUMMY_PASSWORD_HASH = (() => {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = crypto.scryptSync(
    crypto.randomBytes(32).toString('hex'), salt, KEY_LEN,
    { N, r: R, p: P, maxmem: 256 * N * R },
  );
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
})();

export async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('password must be a string');
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const salt = crypto.randomBytes(SALT_LEN);
  // maxmem must be raised above the default 32MB: scrypt needs ~128*N*r bytes.
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: 256 * N * R });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Constant-time verify. Returns false — never throws — for a malformed or
 * missing stored hash, so a corrupted row fails the login closed rather than
 * turning into a 500 that leaks which accounts have bad data.
 */
export async function verifyPassword(candidate, encoded) {
  if (typeof candidate !== 'string' || typeof encoded !== 'string') return false;

  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(candidate, salt, expected.length, {
      N: n, r, p, maxmem: 256 * n * r,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
