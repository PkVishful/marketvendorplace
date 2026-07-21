// @vitest-environment node
// End-to-end proofs for the vendor rate card against the REAL local Postgres:
// window arithmetic on the exclusion constraint, RLS isolation between
// vendors, and the vendor_can_quote bid-gate coupling. Skips cleanly when the
// local test database (scripts/db-test.sh: 127.0.0.1:5433/eworks) is not up —
// the HTTP contract is still covered by vendor-pricing.test.mjs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';

process.env.EWORKS_USE_LOCAL_PG = process.env.EWORKS_USE_LOCAL_PG || '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const OWNER_A = '44444444-0000-0000-0000-00000000000a'; // Kovai Testing Labs, APPROVED
const OWNER_B = '44444444-0000-0000-0000-00000000000b'; // Salem Small Labs, APPROVED
const OWNER_E = '44444444-0000-0000-0000-00000000000e'; // Unapproved Labs, SUBMITTED
const VENDOR_A = '55555555-0000-0000-0000-00000000000a';
const VENDOR_B = '55555555-0000-0000-0000-00000000000b';

// Probe: superuser connection used for fixture reset and direct assertions.
const probe = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2,
});

let dbAvailable = false;
let cubeId = null;
let slumpId = null;
try {
  const q = await probe.query(
    `select (select id from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH') as cube,
            (select id from eworks.test_catalog where code = 'CONCRETE_SLUMP') as slump,
            (select count(*) from eworks.vendors where id = $1) as a`,
    [VENDOR_A],
  );
  cubeId = q.rows[0].cube;
  slumpId = q.rows[0].slump;
  dbAvailable = Boolean(cubeId && slumpId && Number(q.rows[0].a) === 1);
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('vendor pricing against real Postgres', () => {
  let server;
  let base;
  let cookieFor;
  let dbPool;

  beforeAll(async () => {
    const { createApp } = await import('./bff.mjs');
    const { loadConfig } = await import('./env.mjs');
    const { setSessionCookie } = await import('./security.mjs');
    const db = await import('./db.mjs');
    dbPool = db.pool;
    const config = loadConfig({ ...process.env, EWORKS_ENV: undefined });
    cookieFor = (userId) => {
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
      setSessionCookie(res, userId, config);
      return res.headers['Set-Cookie'].split(';')[0];
    };
    const provider = { async send() { return { delivered: true }; } };
    const app = createApp(config, { provider });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (dbPool) await dbPool.end();
    await probe.end();
  });

  // Every test starts from the same state: A and B each hold one open-ended
  // Rs 2,500.00 window on the cube test that began 30 days ago.
  beforeEach(async () => {
    await probe.query(
      `delete from eworks.vendor_test_pricing where test_id = $1`, [cubeId],
    );
    await probe.query(
      `insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from)
       values ($1, $3, 250000, current_date - 30), ($2, $3, 250000, current_date - 30)`,
      [VENDOR_A, VENDOR_B, cubeId],
    );
  });

  async function api(userId, method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie: cookieFor(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  async function effectivePrice(vendorId, onDateSql = 'current_date') {
    const q = await probe.query(
      `select eworks.vendor_effective_price($1, $2, ${onDateSql}) as p`, [vendorId, cubeId],
    );
    return q.rows[0].p == null ? null : Number(q.rows[0].p);
  }

  it('set price effective today: window opens today, old one closes at the boundary', async () => {
    const r = await api(OWNER_A, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 275000 });
    expect(r.status).toBe(200);
    expect(await effectivePrice(VENDOR_A)).toBe(275000);
    // yesterday still shows the old price — history is intact
    expect(await effectivePrice(VENDOR_A, "current_date - 1")).toBe(250000);
  });

  it('future-dated change closes the old window at the boundary and flips on that date', async () => {
    const dQ = await probe.query(`select (current_date + 10)::text as d`);
    const flipDate = dQ.rows[0].d;
    const r = await api(OWNER_A, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 300000, effectiveFrom: flipDate });
    expect(r.status).toBe(200);
    expect(await effectivePrice(VENDOR_A)).toBe(250000);                       // today: unchanged
    expect(await effectivePrice(VENDOR_A, 'current_date + 9')).toBe(250000);   // day before flip
    expect(await effectivePrice(VENDOR_A, 'current_date + 10')).toBe(300000);  // flip day
    const oldQ = await probe.query(
      `select effective_to::text as t from eworks.vendor_test_pricing
        where vendor_id = $1 and test_id = $2 and price_paise = 250000`, [VENDOR_A, cubeId],
    );
    expect(oldQ.rows[0].t).toBe(flipDate); // closed exactly at the boundary — no hole, no overlap
  });

  it('409 on overlap with an existing future window, which is not deleted', async () => {
    const dQ = await probe.query(`select (current_date + 10)::text as far, (current_date + 5)::text as near`);
    const far = dQ.rows[0].far;
    const first = await api(OWNER_A, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 300000, effectiveFrom: far });
    expect(first.status).toBe(200);
    const second = await api(OWNER_A, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 280000, effectiveFrom: dQ.rows[0].near });
    expect(second.status).toBe(409);
    expect(second.body.detail).toContain(far);
    const stillThere = await probe.query(
      `select count(*)::int as n from eworks.vendor_test_pricing
        where vendor_id = $1 and test_id = $2 and price_paise = 300000`, [VENDOR_A, cubeId],
    );
    expect(stillThere.rows[0].n).toBe(1);
  });

  it('403 pricing a test without an active capability', async () => {
    const r = await api(OWNER_A, 'PUT', `/api/vendor/pricing/${slumpId}`, { pricePaise: 50000 });
    expect(r.status).toBe(403);
  });

  it('403 for a non-approved vendor', async () => {
    const r = await api(OWNER_E, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 50000 });
    expect(r.status).toBe(403);
  });

  it('RLS: vendor B never sees vendor A rows through any pricing endpoint', async () => {
    await api(OWNER_A, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 999900 });

    const list = await api(OWNER_B, 'GET', '/api/vendor/pricing');
    expect(list.status).toBe(200);
    const cubeRow = list.body.find((row) => row.testId === cubeId);
    expect(cubeRow.currentPricePaise).toBe(250000); // B's own price, not A's 999900
    expect(list.body.some((row) => row.currentPricePaise === 999900)).toBe(false);

    const history = await api(OWNER_B, 'GET', `/api/vendor/pricing/${cubeId}/history`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1); // only B's own baseline window
    expect(history.body.some((w) => w.pricePaise === 999900)).toBe(false);

    // B's mutations can only ever land on B's vendor: A's price is untouched
    // after B sets its own.
    await api(OWNER_B, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 111100 });
    expect(await effectivePrice(VENDOR_A)).toBe(999900);
    expect(await effectivePrice(VENDOR_B)).toBe(111100);
  });

  it('delete closes the bid gate: vendor_can_quote flips to false', async () => {
    const before = await probe.query(
      `select eworks.vendor_can_quote($1, $2) as q`, [VENDOR_A, cubeId],
    );
    expect(before.rows[0].q).toBe(true);

    const r = await api(OWNER_A, 'DELETE', `/api/vendor/pricing/${cubeId}`);
    expect(r.status).toBe(200);

    const after = await probe.query(
      `select eworks.vendor_can_quote($1, $2) as q`, [VENDOR_A, cubeId],
    );
    expect(after.rows[0].q).toBe(false);

    const list = await api(OWNER_A, 'GET', '/api/vendor/pricing');
    expect(list.body.find((row) => row.testId === cubeId).isPricedToday).toBe(false);

    const again = await api(OWNER_A, 'DELETE', `/api/vendor/pricing/${cubeId}`);
    expect(again.status).toBe(404);
  });

  it('mutations append hash-chained audit rows', async () => {
    await api(OWNER_A, 'PUT', `/api/vendor/pricing/${cubeId}`, { pricePaise: 260000 });
    await api(OWNER_A, 'DELETE', `/api/vendor/pricing/${cubeId}`);
    const q = await probe.query(
      `select action from eworks.audit_logs
        where actor_id = $1 and entity_type = 'vendor_test_pricing'
        order by seq desc limit 2`, [OWNER_A],
    );
    expect(q.rows.map((r) => r.action).sort()).toEqual(['vendor.price_set', 'vendor.price_stop']);
  });
});

if (!dbAvailable) {
  describe('vendor pricing against real Postgres', () => {
    it.skip('skipped — local test DB not reachable (run scripts/db-test.sh first)', () => {});
  });
}
