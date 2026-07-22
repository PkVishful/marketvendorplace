// @vitest-environment node
// GET /api/vendor/jobs/:id against the REAL local Postgres (127.0.0.1:5433).
// Regression guard for the field-technician RLS catch-22: the assigned
// technician can read the job (jobs_read policy) but NOT the vendor row
// (vendors_read is owner/officer-only). The job-detail query must not drop the
// job just because the caller cannot see the vendor. Skips when the local
// cluster is down or no suitable fixture job exists.
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

const probe = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2,
});

let dbAvailable = false;
let fixture = null; // { jobId, techId, ownerId }
try {
  // A job whose assigned technician is NOT the vendor owner: the technician can
  // read the job but cannot read the vendor row, so an inner join to vendors
  // would hide the job from them.
  const q = await probe.query(`
    select j.id as "jobId", j.technician_id as "techId", v.owner_user_id as "ownerId"
      from eworks.test_jobs j
      join eworks.vendors v on v.id = j.vendor_id
     where j.technician_id is not null
       and j.technician_id <> v.owner_user_id
     limit 1`);
  fixture = q.rows[0] ?? null;
  dbAvailable = Boolean(fixture);
} catch {
  dbAvailable = false;
}

// No-op SMS provider; these routes never send OTP.
const provider = { async send() { return { delivered: true }; } };
const config = loadConfig({});

async function devLogin(port, userId) {
  const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const cookie = r.headers.get('set-cookie');
  return { status: r.status, cookie };
}

describe.skipIf(!dbAvailable)('GET /api/vendor/jobs/:id as the assigned technician', () => {
  let srv, port;
  beforeAll(async () => {
    const app = createApp(config, { provider });
    await new Promise((resolve) => { srv = app.listen(0, () => { port = srv.address().port; resolve(); }); });
  });
  afterAll(async () => {
    await new Promise((r) => (srv ? srv.close(r) : r()));
    await probe.end();
  });

  it('is not the vendor owner (the fixture actually exercises the RLS gap)', () => {
    expect(fixture.techId).not.toBe(fixture.ownerId);
  });

  it('returns the job (not 404) even though the technician cannot see the vendor', async () => {
    const { status, cookie } = await devLogin(port, fixture.techId);
    expect(status).toBe(200);

    const r = await fetch(`http://127.0.0.1:${port}/api/vendor/jobs/${fixture.jobId}`, {
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(fixture.jobId);
    // vendorName is owner-visible only; for the technician it degrades to null
    // rather than hiding the whole job.
    expect('vendorName' in body).toBe(true);
  });
});
