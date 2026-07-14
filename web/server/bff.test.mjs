// web/server/bff.test.mjs
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from './env.mjs';
import { createApp } from './bff.mjs';

// A no-op provider so createApp needs no real SMS; DB is never hit by these routes.
const provider = { async send() { return { delivered: true }; } };

function listen(config) {
  const app = createApp(config, { provider });
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}
let open;
afterEach(() => new Promise((r) => (open ? open.close(r) : r())));

const prod = loadConfig({
  EWORKS_ENV: 'production', OTP_PEPPER: 'p'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', EWORKS_USE_LOCAL_PG: '1',
});
const dev = loadConfig({});

describe('bff app wiring', () => {
  it('health endpoint responds', async () => {
    const { srv, port } = await listen(dev); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('dev-only routes are mounted in dev (400, not 404)', async () => {
    const { srv, port } = await listen(dev); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(400); // reached the handler, missing userId
  });

  it('dev-only routes are ABSENT in production (404)', async () => {
    const { srv, port } = await listen(prod); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(404);

    // The dev-only "advance" routes are gated in a separate `if (!config.isProd)`
    // block from /api/dev/login — assert they're also absent in production.
    const rOrder = await fetch(`http://127.0.0.1:${port}/api/dev/orders/x/advance`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(rOrder.status).toBe(404);

    const rJob = await fetch(`http://127.0.0.1:${port}/api/dev/jobs/x/advance`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(rJob.status).toBe(404);
  });

  it('CORS allows the configured origin in production', async () => {
    const { srv, port } = await listen(prod); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: 'https://getlegal.anvastech.in' },
    });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://getlegal.anvastech.in');
  });
});
