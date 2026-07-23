// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from './password.mjs';

describe('hashPassword', () => {
  it('never stores the password in the encoded output', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded).not.toContain('correct');
    expect(encoded).not.toContain('staple');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('records the algorithm and cost in the encoded form so it can be migrated later', async () => {
    const encoded = await hashPassword('whatever-long-enough');
    expect(encoded.startsWith('scrypt$')).toBe(true);
    expect(encoded.split('$')).toHaveLength(6); // scrypt$N$r$p$salt$hash
  });

  it('rejects a password shorter than the documented minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/i);
  });

  it('rejects a non-string password rather than hashing "undefined"', async () => {
    await expect(hashPassword(undefined)).rejects.toThrow();
    await expect(hashPassword(null)).rejects.toThrow();
  });
});

describe('verifyPassword', () => {
  it('accepts the password it was derived from', async () => {
    const encoded = await hashPassword('s3cure-enough-password');
    expect(await verifyPassword('s3cure-enough-password', encoded)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const encoded = await hashPassword('s3cure-enough-password');
    expect(await verifyPassword('s3cure-enough-passwerd', encoded)).toBe(false);
  });

  it('rejects rather than throwing when the stored hash is malformed', async () => {
    // A corrupted or legacy row must fail closed, not 500 the login route.
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$16384$8$1$onlyfivefields')).toBe(false);
  });

  it('rejects an empty candidate against a real hash', async () => {
    const encoded = await hashPassword('s3cure-enough-password');
    expect(await verifyPassword('', encoded)).toBe(false);
  });

  it('is case sensitive', async () => {
    const encoded = await hashPassword('CaseSensitivePassword');
    expect(await verifyPassword('casesensitivepassword', encoded)).toBe(false);
  });

  it('exposes a minimum length the sign-up path can quote to users', () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
  });
});
