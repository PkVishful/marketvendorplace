// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadConfig } from './env.mjs';

const prodBase = {
  EWORKS_ENV: 'production',
  OTP_PEPPER: 'x'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in',
  EWORKS_USE_LOCAL_PG: '1',
};

describe('loadConfig', () => {
  it('defaults to dev with dev port and insecure cookies', () => {
    const c = loadConfig({});
    expect(c.env).toBe('dev');
    expect(c.isProd).toBe(false);
    expect(c.port).toBe(8787);
    expect(c.cookieSecure).toBe(false);
  });

  it('resolves production config with secure cookies and port 3001', () => {
    const c = loadConfig(prodBase);
    expect(c.isProd).toBe(true);
    expect(c.cookieSecure).toBe(true);
    expect(c.port).toBe(3001);
    expect(c.corsOrigin).toBe('https://getlegal.anvastech.in');
  });

  it('throws in production when OTP_PEPPER is missing', () => {
    const { OTP_PEPPER, ...rest } = prodBase;
    expect(() => loadConfig(rest)).toThrow(/OTP_PEPPER/);
  });

  it('throws in production when no DB connection is configured', () => {
    const { EWORKS_USE_LOCAL_PG, ...rest } = prodBase;
    expect(() => loadConfig(rest)).toThrow(/DB|DATABASE|LOCAL_PG/);
  });

  it('is frozen', () => {
    const c = loadConfig({});
    expect(() => { c.isProd = true; }).toThrow();
  });
});
