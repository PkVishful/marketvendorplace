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
try {
  const q = await probe.query(`
    select ur.user_id as "userId"
      from eworks.user_roles ur
     where ur.role_code = 'DISTRICT_OFFICER' limit 1`);
  officer = q.rows[0] ?? null;
  dbAvailable = Boolean(officer);
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
  });
});
