// @vitest-environment node
// Proves the seeded catalog renders the exact per-level counts from the spec.
// Skips when the local test DB (scripts/db-test.sh: 127.0.0.1:5433/eworks) is
// down. Needs a real authenticated user id for the session cookie.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

process.env.EWORKS_USE_LOCAL_PG = process.env.EWORKS_USE_LOCAL_PG || '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const probe = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2,
});

let dbAvailable = false;
let userId = null;
try {
  const q = await probe.query(
    `select up.id from eworks.user_profiles up
      where up.id in (select user_id from eworks.user_roles) limit 1`,
  );
  userId = q.rows[0]?.id ?? null;
  dbAvailable = Boolean(userId);
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('catalog checklist against real Postgres', () => {
  let server; let base; let cookie;

  beforeAll(async () => {
    const { createApp } = await import('./bff.mjs');
    const { loadConfig } = await import('./env.mjs');
    const provider = { async send() { return { delivered: true }; } };
    const app = createApp(loadConfig({ EWORKS_USE_LOCAL_PG: '1' }), { provider });
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    cookie = res.headers.get('set-cookie');
  });

  afterAll(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await probe.end();
  });

  it('renders 9 stages in ascending sequence with the spec per-level counts', async () => {
    const res = await fetch(`${base}/api/catalog/checklist`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stages.length).toBe(9);
    const seqs = body.stages.map((s) => s.sequence);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // already ascending
    expect(body.stages.map((s) => s.tests.length)).toEqual([8, 2, 12, 5, 15, 4, 9, 6, 14]);
    expect(body.crossStage.map((t) => t.code).sort()).toEqual(['CONCRETE_MIX_DESIGN', 'WATER_QUALITY']);
  });

  it('marks repeating tests across stages', async () => {
    const res = await fetch(`${base}/api/catalog/checklist`, { headers: { cookie } });
    const body = await res.json();
    const repeating = body.stages.flatMap((s) => s.tests)
      .filter((t) => t.repeatsAcrossStages).map((t) => t.code);
    expect(repeating).toContain('CONCRETE_SLUMP');
    expect(repeating).toContain('CONCRETE_CUBE_STRENGTH');
  });
});
