import { describe, it, expect } from 'vitest';
import { ORG_PROFILE_KEY, emptyOrgProfile, parseOrgProfile, validateOrgProfile } from './orgProfile';

describe('parseOrgProfile', () => {
  it('returns the empty profile when the setting has never been saved', () => {
    expect(parseOrgProfile(undefined)).toEqual(emptyOrgProfile());
    expect(parseOrgProfile(null)).toEqual(emptyOrgProfile());
  });

  it('ignores a stored value of the wrong shape rather than crashing the page', () => {
    // eworks.settings is untyped jsonb; a hand-edited row must not white-screen
    // the only screen that can fix it.
    expect(parseOrgProfile('a string')).toEqual(emptyOrgProfile());
    expect(parseOrgProfile(42)).toEqual(emptyOrgProfile());
    expect(parseOrgProfile([])).toEqual(emptyOrgProfile());
  });

  it('keeps known fields and drops unknown ones', () => {
    const parsed = parseOrgProfile({ name: 'TN PWD', industry: 'Public Works', sneaky: 'x' });
    expect(parsed.name).toBe('TN PWD');
    expect(parsed.industry).toBe('Public Works');
    expect((parsed as Record<string, unknown>).sneaky).toBeUndefined();
  });

  it('coerces a non-string field to the empty string', () => {
    const parsed = parseOrgProfile({ name: 123, city: null });
    expect(parsed.name).toBe('');
    expect(parsed.city).toBe('');
  });

  it('uses a stable settings key so the row is findable', () => {
    expect(ORG_PROFILE_KEY).toBe('org_profile');
  });
});

describe('validateOrgProfile', () => {
  it('accepts a profile with the required fields filled', () => {
    const profile = { ...emptyOrgProfile(), name: 'TN PWD', location: 'India' };
    expect(validateOrgProfile(profile)).toEqual({});
  });

  it('requires an organisation name', () => {
    const errors = validateOrgProfile({ ...emptyOrgProfile(), location: 'India' });
    expect(errors.name).toBeTruthy();
  });

  it('treats a whitespace-only name as missing', () => {
    const errors = validateOrgProfile({ ...emptyOrgProfile(), name: '   ', location: 'India' });
    expect(errors.name).toBeTruthy();
  });

  it('requires a location', () => {
    const errors = validateOrgProfile({ ...emptyOrgProfile(), name: 'TN PWD' });
    expect(errors.location).toBeTruthy();
  });

  it('rejects a pin code that is not six digits', () => {
    const base = { ...emptyOrgProfile(), name: 'TN PWD', location: 'India' };
    expect(validateOrgProfile({ ...base, pinCode: '12345' }).pinCode).toBeTruthy();
    expect(validateOrgProfile({ ...base, pinCode: 'abcdef' }).pinCode).toBeTruthy();
    expect(validateOrgProfile({ ...base, pinCode: '641001' }).pinCode).toBeUndefined();
  });

  it('allows an empty pin code, since address is optional', () => {
    const base = { ...emptyOrgProfile(), name: 'TN PWD', location: 'India' };
    expect(validateOrgProfile({ ...base, pinCode: '' }).pinCode).toBeUndefined();
  });
});
