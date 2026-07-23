// @vitest-environment node
//
// Area drill-down against a real database. Skips wholesale when local Postgres
// is not up (docker start eworks-pg), like the other .db.test.mjs suites.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadConfig } from './env.mjs';
import { createApp } from './bff.mjs';
import { loadSubtreeSummary } from './area-queries.mjs';

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
let district = null; // { id, path }
try {
  const q = await probe.query(
    `select id, path::text as path from eworks.org_units
      where level = 'DISTRICT' order by name limit 1`);
  district = q.rows[0] ?? null;
  dbAvailable = Boolean(district);
} catch { dbAvailable = false; }

const config = loadConfig({});
const provider = { async send() { return { delivered: true }; } };

describe.skipIf(!dbAvailable)('loadSubtreeSummary', () => {
  let srv;
  beforeAll(async () => {
    const app = createApp(config, { provider });
    await new Promise((res) => { srv = app.listen(0, res); });
  });
  afterAll(async () => {
    await new Promise((r) => (srv ? srv.close(r) : r()));
    await probe.end();
  });

  it('counts pending vendor approvals from the district subtree only', async () => {
    const expected = await probe.query(
      `select count(*)::int as n
         from eworks.vendors v
         join eworks.org_units ou on ou.id = v.org_unit_id
        where ou.path <@ $1::ltree and v.status = 'SUBMITTED'`,
      [district.path]);

    const client = await probe.connect();
    try {
      const summary = await loadSubtreeSummary(client, district.path);
      expect(summary.pendingApprovals).toBe(expected.rows[0].n);
    } finally {
      client.release();
    }
  }, 15000);

  it('returns a full summary shape with a null-or-number quality score', async () => {
    const client = await probe.connect();
    try {
      const summary = await loadSubtreeSummary(client, district.path);
      expect(summary).toEqual(expect.objectContaining({
        openOrders: expect.any(Number),
        activeJobs: expect.any(Number),
        failedTests30d: expect.any(Number),
        certificates30d: expect.any(Number),
        pendingApprovals: expect.any(Number),
      }));
      expect(summary.qualityScore === null || typeof summary.qualityScore === 'number').toBe(true);
    } finally {
      client.release();
    }
  }, 15000);
});
