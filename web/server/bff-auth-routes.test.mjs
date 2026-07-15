// @vitest-environment node
// Route-level contract for /api/auth/otp/send: what the browser is allowed to
// see. Demo codes appear ONLY in demo mode (never production), and the MFA
// step obeys MFA_ENABLED.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import { __resetChallenges } from './auth.mjs';

vi.mock('./db.mjs', () => ({
  pool: {
    query: vi.fn(async (sql) => {
      if (sql.includes('user_profiles')) return { rows: [{ id: 'gov-user-1' }] };
      if (sql.includes('user_roles')) return { rows: [{ role_code: 'HEAD_ADMIN' }] };
      return { rows: [], rowCount: 0 };
    }),
  },
  withUserSession: vi.fn(),
  lookupProfile: vi.fn(),
}));

const { createApp } = await import('./bff.mjs');

function captureProvider() {
  const sent = [];
  return { sent, async send(m) { sent.push(m); return { delivered: true }; } };
}

async function postSend(config, provider) {
  const app = createApp(config, { provider });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9944312345' }),
    });
    return await res.json();
  } finally {
    server.close();
  }
}

const prodEnv = {
  EWORKS_ENV: 'production', OTP_PEPPER: 'p'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', SESSION_SECRET: 's'.repeat(32),
  EWORKS_USE_LOCAL_PG: '1',
};

beforeEach(() => __resetChallenges());

describe('otp send response contract', () => {
  it('demo mode returns demoOtp and demoMfa matching the delivered codes', async () => {
    const p = captureProvider();
    const body = await postSend(loadConfig({ DEMO_MODE: 'true' }), p);
    expect(body.sent).toBe(true);
    expect(body.requiresMfa).toBe(true); // HEAD_ADMIN
    expect(body.demoOtp).toBe(p.sent.find((m) => m.purpose === 'otp').code);
    expect(body.demoMfa).toBe(p.sent.find((m) => m.purpose === 'mfa').code);
  });

  it('PRODUCTION response never contains any delivered code, even with DEMO_MODE=true', async () => {
    const p = captureProvider();
    const body = await postSend(loadConfig({ ...prodEnv, DEMO_MODE: 'true' }), p);
    expect(body.sent).toBe(true);
    expect(body).not.toHaveProperty('demoOtp');
    expect(body).not.toHaveProperty('demoMfa');
    const raw = JSON.stringify(body);
    for (const m of p.sent) expect(raw).not.toContain(m.code);
  });

  it('normal (non-demo) dev response has no demo fields either', async () => {
    const body = await postSend(loadConfig({}), captureProvider());
    expect(body).not.toHaveProperty('demoOtp');
    expect(body).not.toHaveProperty('demoMfa');
  });

  it('MFA_ENABLED=false skips the MFA challenge even for government roles', async () => {
    const p = captureProvider();
    const body = await postSend(loadConfig({ ...prodEnv, MFA_ENABLED: 'false' }), p);
    expect(body.requiresMfa).toBe(false);
    expect(p.sent.map((m) => m.purpose)).toEqual(['otp']); // no mfa send
  });
});
