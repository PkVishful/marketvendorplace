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
let headAdmin = null; // { userId }
let officerA = null; // { userId, orgUnitId, name } — two officers in *different* districts
let officerB = null;
let stateNode = null;
let branchingDistrict = null;
let linearDistrict = null;
let fieldUnit = null;
try {
  const q = await probe.query(
    `select id, path::text as path from eworks.org_units
      where level = 'DISTRICT' order by name limit 1`);
  district = q.rows[0] ?? null;

  stateNode = (await probe.query(
    `select id, path::text as path from eworks.org_units where level = 'STATE' limit 1`)).rows[0] ?? null;

  headAdmin = (await probe.query(
    `select user_id as "userId" from eworks.user_roles where role_code = 'HEAD_ADMIN' limit 1`)).rows[0] ?? null;

  const officers = (await probe.query(
    `select ur.user_id as "userId", ou.id as "orgUnitId", ou.name, ou.path::text as path
       from eworks.user_roles ur
       join eworks.org_units ou on ou.id = ur.org_unit_id
      where ur.role_code = 'DISTRICT_OFFICER' and ou.level = 'DISTRICT'
      order by ou.name limit 2`)).rows;
  [officerA, officerB] = officers;

  // Most seeded districts are a straight single-child chain from DISTRICT down
  // to PROJECT; exactly one branches (two sections). The two shapes collapse to
  // different depths, so the tests below need one of each, chosen by shape
  // rather than by name.
  branchingDistrict = (await probe.query(
    `select d.id, d.name, d.path::text as path
       from eworks.org_units d
      where d.level = 'DISTRICT'
        and (select count(*) from eworks.org_units s
              where s.path <@ d.path and s.level = 'SECTION') > 1
      limit 1`)).rows[0] ?? null;

  linearDistrict = (await probe.query(
    `select d.id, d.name, d.path::text as path
       from eworks.org_units d
      where d.level = 'DISTRICT'
        and (select count(*) from eworks.org_units s
              where s.path <@ d.path and s.level = 'SECTION') = 1
      limit 1`)).rows[0] ?? null;

  fieldUnit = (await probe.query(
    `select id from eworks.org_units where level = 'FIELD_UNIT' limit 1`)).rows[0] ?? null;

  dbAvailable = Boolean(district && headAdmin && officerA && officerB && stateNode
    && branchingDistrict && linearDistrict && fieldUnit);
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

describe.skipIf(!dbAvailable)('GET /api/gov/area/:orgUnitId?', () => {
  let srv, port;
  beforeAll(async () => {
    const app = createApp(config, { provider });
    await new Promise((res) => { srv = app.listen(0, () => { port = srv.address().port; res(); }); });
  });
  afterAll(async () => { await new Promise((r) => (srv ? srv.close(r) : r())); });

  async function login(userId) {
    const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }) });
    return r.headers.get('set-cookie');
  }
  async function area(userId, orgUnitId) {
    const cookie = await login(userId);
    const url = `http://127.0.0.1:${port}/api/gov/area${orgUnitId ? `/${orgUnitId}` : ''}`;
    const r = await fetch(url, { headers: { cookie } });
    return { status: r.status, body: r.status === 200 ? await r.json() : null };
  }

  it('403s when a district officer requests another district', async () => {
    const res = await area(officerA.userId, officerB.orgUnitId);
    expect(res.status).toBe(403);
  }, 15000);

  it('403s when a district officer requests the state node', async () => {
    const res = await area(officerA.userId, stateNode.id);
    expect(res.status).toBe(403);
  }, 15000);

  it('defaults to the caller own anchor when no id is given', async () => {
    const { status, body } = await area(officerA.userId, undefined);
    expect(status).toBe(200);
    expect(body.breadcrumbs.some((c) => c.name === officerA.name)).toBe(true);
  }, 15000);

  it('marks crumbs above the caller anchor as out of scope', async () => {
    const { body } = await area(officerA.userId, undefined);
    const state = body.breadcrumbs.find((c) => c.level === 'STATE');
    expect(state).toBeDefined();
    expect(state.inScope).toBe(false);
  }, 15000);

  it('collapses a district down to its first branching level', async () => {
    const { status, body } = await area(headAdmin.userId, branchingDistrict.id);
    expect(status).toBe(200);
    // District -> Division -> Circle -> Subdivision is single-child, so the
    // effective node is the subdivision where the sections fan out.
    expect(body.node.level).toBe('SUBDIVISION');
    expect(body.children.length).toBeGreaterThan(1);
    // The collapsed-through nodes are reported, not silently dropped.
    expect(body.skipped.map((s) => s.level)).toEqual(['DISTRICT', 'DIVISION', 'CIRCLE']);
  }, 15000);

  it('collapses a fully linear district all the way to its project', async () => {
    const { status, body } = await area(headAdmin.userId, linearDistrict.id);
    expect(status).toBe(200);
    expect(body.node.level).toBe('PROJECT');
    // A project is a leaf: no scored children, and it is not listed under itself.
    expect(body.children).toEqual([]);
    expect(body.projects).toEqual([]);
  }, 15000);

  it('reports projects rather than scored children one level above a project', async () => {
    const { status, body } = await area(headAdmin.userId, fieldUnit.id);
    expect(status).toBe(200);
    // FIELD_UNIT has exactly one project child, so it collapses onto it.
    expect(body.node.level).toBe('PROJECT');
  }, 15000);

  it('returns a summary and children for the state node as head admin', async () => {
    const { status, body } = await area(headAdmin.userId, undefined);
    expect(status).toBe(200);
    expect(body.node.level).toBe('STATE');
    expect(body.children).toHaveLength(38);
    expect(body.summary).toEqual(expect.objectContaining({
      openOrders: expect.any(Number), pendingApprovals: expect.any(Number),
    }));
  }, 15000);

  it('403s on a syntactically valid but nonexistent node, same as out-of-scope', async () => {
    const res = await area(officerA.userId, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(403);
  }, 15000);
});
