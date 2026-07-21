// @vitest-environment node
// assign_job against the REAL local Postgres (scripts/db-test.sh: 127.0.0.1:5433).
// Skips cleanly when the local cluster is down.
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
let target = null; // { orderId, vendorId, ownerId }
try {
  const fn = await probe.query(`select 1 from pg_proc where proname = 'assign_job'`);
  const q = await probe.query(`
    select o.id as "orderId", oa.vendor_id as "vendorId", v.owner_user_id as "ownerId"
      from eworks.test_orders o
      join eworks.order_award oa on oa.order_id = o.id
      join eworks.vendors v on v.id = oa.vendor_id
     where o.status = 'AWARDED'
       and not exists (select 1 from eworks.test_jobs j where j.order_id = o.id)
       and v.owner_user_id is not null
     limit 1`);
  target = q.rows[0] ?? null;
  dbAvailable = fn.rowCount === 1 && Boolean(target);
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('assign_job against real Postgres', () => {
  let withUserSession, pool, otherOwner;

  beforeAll(async () => {
    ({ withUserSession, pool } = await import('./db.mjs'));
    const o = await probe.query(
      `select owner_user_id from eworks.vendors
        where owner_user_id is not null and id <> $1 limit 1`, [target.vendorId]);
    otherOwner = o.rows[0].owner_user_id;
  });

  afterAll(async () => { await probe.end(); await pool.end(); });

  it('lets the winning owner create the job with themselves as technician', async () => {
    const job = await withUserSession(target.ownerId, async (client) => {
      const r = await client.query(`select * from eworks.assign_job($1)`, [target.orderId]);
      return r.rows[0];
    });
    expect(job.order_id).toBe(target.orderId);
    expect(job.vendor_id).toBe(target.vendorId);
    expect(job.technician_id).toBe(target.ownerId);
    expect(job.status).toBe('ASSIGNED');
  });

  it('rejects a second accept (one job per order)', async () => {
    await expect(withUserSession(target.ownerId, (client) =>
      client.query(`select * from eworks.assign_job($1)`, [target.orderId]),
    )).rejects.toThrow(/test_jobs_one_per_order|duplicate key/);
  });

  it('rejects an owner who did not win the order', async () => {
    const fresh = await probe.query(`
      select o.id from eworks.test_orders o
        join eworks.order_award oa on oa.order_id = o.id
       where o.status = 'AWARDED'
         and not exists (select 1 from eworks.test_jobs j where j.order_id = o.id)
       limit 1`);
    if (fresh.rowCount === 0) return; // nothing left to assert against
    await expect(withUserSession(otherOwner, (client) =>
      client.query(`select * from eworks.assign_job($1)`, [fresh.rows[0].id]),
    )).rejects.toThrow(/only the winning vendor|insufficient/i);
  });
});
