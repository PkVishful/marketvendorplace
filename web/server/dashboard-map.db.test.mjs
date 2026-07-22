// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadConfig } from './env.mjs';
import { createApp } from './bff.mjs';

process.env.EWORKS_USE_LOCAL_PG = process.env.EWORKS_USE_LOCAL_PG || '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const probe = new pg.Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2 });

let dbAvailable = false;
let officer = null; // { userId }
let officers = []; // [{ userId }, ...] distinct district officers, for scope-isolation
try {
  const q = await probe.query(`
    select ur.user_id as "userId"
      from eworks.user_roles ur
     where ur.role_code = 'DISTRICT_OFFICER' limit 1`);
  officer = q.rows[0] ?? null;
  dbAvailable = Boolean(officer);
  const qAll = await probe.query(`
    select distinct ur.user_id as "userId"
      from eworks.user_roles ur
     where ur.role_code = 'DISTRICT_OFFICER' limit 5`);
  officers = qAll.rows;
} catch { dbAvailable = false; }

const provider = { async send() { return { delivered: true }; } };
const config = loadConfig({});

async function login(port, userId) {
  const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }) });
  return r.headers.get('set-cookie');
}

describe.skipIf(!dbAvailable)('GET /api/gov/dashboard/map', () => {
  let srv, port;
  beforeAll(async () => {
    const app = createApp(config, { provider });
    await new Promise((res) => { srv = app.listen(0, () => { port = srv.address().port; res(); }); });
  });
  afterAll(async () => { await new Promise((r) => (srv ? srv.close(r) : r())); await probe.end(); });

  it('returns the officer district scope with shaped regions', async () => {
    const cookie = await login(port, officer.userId);
    const r = await fetch(`http://127.0.0.1:${port}/api/gov/dashboard/map`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.level).toBe('district');
    expect(Array.isArray(body.regions)).toBe(true);
    for (const region of body.regions) {
      expect(typeof region.id).toBe('string');
      expect(region.score === null || typeof region.score === 'number').toBe(true);
      expect(region.kpis).toEqual(expect.objectContaining({
        openOrders: expect.any(Number), activeJobs: expect.any(Number),
        failedTests30d: expect.any(Number), certificates30d: expect.any(Number),
        vendorsActive: expect.any(Number),
      }));
    }
  }, 15000);

  // Timeouts bumped: this hits real Postgres 3x (children + orders + KPI
  // queries) per request, which can run past the 5s default under full-suite
  // parallel load alongside the other .db.test.mjs files.
  it.skipIf(officers.length < 2)('scopes regions to each officer\'s own district (no overlap)', async () => {
    const [a, b] = officers;
    const cookieA = await login(port, a.userId);
    const cookieB = await login(port, b.userId);
    const rA = await fetch(`http://127.0.0.1:${port}/api/gov/dashboard/map`, { headers: { cookie: cookieA } });
    const rB = await fetch(`http://127.0.0.1:${port}/api/gov/dashboard/map`, { headers: { cookie: cookieB } });
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);
    const bodyA = await rA.json();
    const bodyB = await rB.json();
    const idsA = new Set(bodyA.regions.map((r) => r.id));
    const idsB = new Set(bodyB.regions.map((r) => r.id));
    expect(idsA.size).toBeGreaterThan(0);
    expect(idsB.size).toBeGreaterThan(0);
    const overlap = [...idsA].filter((id) => idsB.has(id));
    expect(overlap).toEqual([]);
  }, 15000);
});
