// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
process.env.EWORKS_USE_LOCAL_PG = '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const probe = new pg.Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE,
  connectionTimeoutMillis: 1500, max: 2 });

let dbAvailable = false;
let officer = null;  // { userId } holding contract.manage over some DRAFT contract
let contract = null; // { id }
try {
  const fn = await probe.query(`select 1 from pg_proc where proname='publish_tender_notice'`);
  const c = await probe.query(`select id, project_id from eworks.contracts where status='DRAFT' limit 1`);
  contract = c.rows[0] ?? null;
  if (contract) {
    const o = await probe.query(
      `select ur.user_id as "userId" from eworks.user_roles ur
         join eworks.role_permissions rp on rp.role_code=ur.role_code
         join eworks.org_units ou on ou.id=ur.org_unit_id
         join eworks.org_units proj on proj.id=$1
        where rp.permission_code='contract.manage' and proj.path <@ ou.path limit 1`,
      [contract.project_id]);
    officer = o.rows[0] ?? null;
  }
  dbAvailable = fn.rowCount === 1 && Boolean(contract) && Boolean(officer);
} catch { dbAvailable = false; }

describe.skipIf(!dbAvailable)('tender rules', () => {
  let withUserSession, pool;
  beforeAll(async () => { ({ withUserSession, pool } = await import('./db.mjs')); });
  afterAll(async () => {
    // Publishing floats the contract (by design), which would consume the
    // only DRAFT fixture the probe above relies on. Reset the fixture back
    // to its pre-test state so repeat runs keep exercising the real rule
    // instead of silently skipping on the next invocation.
    await pool.query(`delete from eworks.tender_corrigenda where notice_id in (select id from eworks.tender_notices where contract_id=$1)`, [contract.id]);
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
    await pool.query(`update eworks.contracts set status='DRAFT' where id=$1`, [contract.id]);
    await probe.end();
    await pool.end();
  });

  it('publish is blocked without a sanction, allowed after, and floats the contract', async () => {
    await withUserSession(officer.userId, async (client) => {
      // fresh notice on the DRAFT contract (clean any prior)
      await client.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
      const n = await client.query(
        `insert into eworks.tender_notices (contract_id, notice_no, scope_summary, estimated_value_paise, completion_period_days, emd_amount_paise, created_by)
         values ($1,'NIT-TEST','scope',100000,90,5000, eworks.current_user_id()) returning id`, [contract.id]);
      const noticeId = n.rows[0].id;
      await client.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
      // Postgres aborts the whole transaction on error; wrap the
      // expected-to-fail call in a savepoint so the rest of this
      // withUserSession transaction can keep going.
      await client.query('savepoint before_publish');
      await expect(client.query(`select eworks.publish_tender_notice($1)`, [noticeId])).rejects.toThrow(/sanction/i);
      await client.query('rollback to savepoint before_publish');
      await client.query(`select eworks.record_sanction($1, 120000, 'GO-1')`, [contract.id]);
      await client.query(`select eworks.publish_tender_notice($1)`, [noticeId]);
      const st = await client.query(`select status from eworks.tender_notices where id=$1`, [noticeId]);
      expect(st.rows[0].status).toBe('PUBLISHED');
      const cs = await client.query(`select status from eworks.contracts where id=$1`, [contract.id]);
      expect(cs.rows[0].status).toBe('FLOATED');
      // corrigendum now allowed + auto-numbers
      const cg = await client.query(`select (eworks.issue_corrigendum($1,'extend dates','{}'::jsonb)).corrigendum_no as n`, [noticeId]);
      expect(cg.rows[0].n).toBe(1);
    });
  }, 15000);
});
