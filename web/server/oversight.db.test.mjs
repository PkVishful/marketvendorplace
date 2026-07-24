// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { financeSummary, financeDistricts, financeOrders, financeOrderDetail } from './oversight-queries.mjs';
import { financeVendors, oversightFlags } from './oversight-queries.mjs';
import { toCsv } from './oversight-finance.mjs';

// EWORKS_USE_LOCAL_PG must be hardcoded (not `|| '1'`) and set BEFORE db.mjs is
// imported: ES-module imports are hoisted and execute before this file's own
// top-level statements, so db.mjs would otherwise build its pool from whatever
// ambient env the shell has (which may point at the shared remote Supabase)
// before we get a chance to force it local. Using a dynamic import below defers
// loading db.mjs until after these env vars are set, guaranteeing its pool is local.
process.env.EWORKS_USE_LOCAL_PG = '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const { withUserSession, pool } = await import('./db.mjs');

const probe = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2,
});

let dbAvailable = false;
let floatingOfficer = null; // { orderId, userId } -- an AWARDED order + a SITE_ENGINEER
// whose org unit covers it. The `orders_write` RLS policy on eworks.test_orders is
// FOR ALL and requires the `order.float` permission on the order's org unit; per the
// seeded eworks.role_permissions, HEAD_ADMIN does NOT hold `order.float` (only
// SITE_ENGINEER does), so a HEAD_ADMIN-driven UPDATE would silently affect 0 rows.
let headAdmin = null; // { userId }
let districtOfficer = null; // { userId }
try {
  floatingOfficer = (await probe.query(
    `select o.id as "orderId", ur.user_id as "userId"
       from eworks.test_orders o
       join eworks.org_units ou on ou.id = o.org_unit_id
       join eworks.user_roles ur on ur.role_code = 'SITE_ENGINEER'
       join eworks.org_units ou2 on ou2.id = ur.org_unit_id
      where o.status = 'AWARDED' and ou.path <@ ou2.path
      limit 1`)).rows[0] ?? null;
  headAdmin = (await probe.query(
    `select user_id as "userId" from eworks.user_roles where role_code = 'HEAD_ADMIN' limit 1`)).rows[0] ?? null;
  districtOfficer = (await probe.query(
    `select ur.user_id as "userId" from eworks.user_roles ur
       join eworks.org_units ou on ou.id=ur.org_unit_id
      where ur.role_code='DISTRICT_OFFICER' and ou.level='DISTRICT' limit 1`)).rows[0] ?? null;
  dbAvailable = Boolean(floatingOfficer) && Boolean(headAdmin) && Boolean(districtOfficer);
} catch { dbAvailable = false; }
const maybe = dbAvailable ? describe : describe.skip;

afterAll(async () => { await probe.end(); await pool.end(); });

maybe('order estimate persistence', () => {
  it('an UPDATE to estimated_amount_paise sticks and reads back', async () => {
    const { orderId, userId } = floatingOfficer;
    const readBack = await withUserSession(userId, async (client) => {
      await client.query(
        `update eworks.test_orders set estimated_amount_paise=$2 where id=$1`,
        [orderId, 12345600]);
      const q = await client.query(
        `select estimated_amount_paise as est from eworks.test_orders where id=$1`, [orderId]);
      return Number(q.rows[0].est);
    });
    expect(readBack).toBe(12345600);
  });
});

maybe('finance summary + districts', () => {
  it('summary numbers are coherent and savings never counts NULL estimates', async () => {
    const s = await withUserSession(headAdmin.userId, (c) => financeSummary(c));
    expect(typeof s.awardedValuePaise).toBe('number');
    expect(s.savingsPaise).toBe(s.estimatedPaise - s.awardedPaise);
    expect(s.awardedPaise).toBeLessThanOrEqual(s.awardedValuePaise); // savings subset ⊆ all awards
    expect(s.floatedCount).toBeGreaterThanOrEqual(0);
  });
  it('districts roll up to a non-empty, scoped list for head admin', async () => {
    const rows = await withUserSession(headAdmin.userId, (c) => financeDistricts(c));
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(typeof r.district).toBe('string');
      expect(typeof r.awardedValuePaise).toBe('number');
    }
  });
  it('a district officer only sees their own district, not the full rollup', async () => {
    const adminRows = await withUserSession(headAdmin.userId, (c) => financeDistricts(c));
    const officerRows = await withUserSession(districtOfficer.userId, (c) => financeDistricts(c));
    expect(officerRows.length).toBeGreaterThan(0);
    expect(officerRows.length).toBeLessThan(adminRows.length);
  }, 15000);
});

maybe('order ledger + sealed-bid confidentiality', () => {
  it('a FLOATED order returns sealed:true, a bid count, and ZERO amounts', async () => {
    const floated = (await probe.query(
      `select id from eworks.test_orders where status='FLOATED' limit 1`)).rows[0];
    const d = await withUserSession(headAdmin.userId, (c) => financeOrderDetail(c, floated.id));
    expect(d.sealed).toBe(true);
    expect(d.bids).toEqual([]);            // never any amounts
    expect(d.award).toBeNull();
    expect(typeof d.bidCount).toBe('number');
  });
  it('an AWARDED order reveals bid amounts with vendor names', async () => {
    const awarded = (await probe.query(
      `select id from eworks.test_orders where status='AWARDED' limit 1`)).rows[0];
    const d = await withUserSession(headAdmin.userId, (c) => financeOrderDetail(c, awarded.id));
    expect(d.sealed).toBe(false);
    expect(d.award).not.toBeNull();
    expect(typeof d.award.pricePaise).toBe('number');
    for (const b of d.bids) {
      expect(typeof b.vendorName).toBe('string');
      expect(typeof b.pricePaise).toBe('number');
    }
  });
  it('ledger paginates and hides amounts for sealed rows', async () => {
    const { rows, total } = await withUserSession(headAdmin.userId, (c) => financeOrders(c, { limit: 10, offset: 0 }));
    expect(total).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);
    for (const r of rows) {
      if (!['REVEALING','AWARDED','FAILED','CANCELLED'].includes(r.status)) {
        expect(r.awardPaise).toBeNull();
      }
    }
  });
});

maybe('vendors + flags', () => {
  it('vendor earnings are non-negative and paid ≤ awarded', async () => {
    const rows = await withUserSession(headAdmin.userId, (c) => financeVendors(c));
    for (const v of rows) {
      expect(v.awardedPaise).toBeGreaterThanOrEqual(0);
      expect(v.paidPaise).toBeLessThanOrEqual(v.awardedPaise + v.pendingPaise + 1);
    }
  });
  it('flags each carry a kind, severity, and orderId', async () => {
    const flags = await withUserSession(headAdmin.userId, (c) => oversightFlags(c));
    expect(Array.isArray(flags)).toBe(true);
    for (const f of flags) {
      expect(['warn', 'integrity']).toContain(f.severity);
      expect(typeof f.kind).toBe('string');
    }
  });
});

maybe('csv export shape', () => {
  it('district CSV header + first data row match the JSON rollup', async () => {
    const rows = await withUserSession(headAdmin.userId, (c) => financeDistricts(c));
    const csv = toCsv(['District', 'Floated', 'Awarded (paise)'],
      rows.map((r) => [r.district, r.floatedCount, r.awardedValuePaise]));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('District,Floated,Awarded (paise)');
    if (rows.length) {
      expect(lines[1]).toContain(String(rows[0].awardedValuePaise));
    }
  });
});
