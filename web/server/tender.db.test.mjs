// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { publicTenderBoard, publicTenderDetail } from './tender-queries.mjs';
process.env.EWORKS_USE_LOCAL_PG = '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

// Obtained once at module scope (env vars above are set before this import,
// so db.mjs picks up the local PG target) and shared by every describe below.
let withUserSession, pool;
({ withUserSession, pool } = await import('./db.mjs'));

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

describe.skipIf(!dbAvailable)('public tender safety', () => {
  it('the public board returns only PUBLISHED notices, never DRAFT/CANCELLED', async () => {
    const rows = await publicTenderBoard(pool);
    for (const r of rows) {
      const s = await pool.query(`select status from eworks.tender_notices where id=$1`, [r.noticeId]);
      expect(s.rows[0].status).toBe('PUBLISHED');
    }
  });
});

describe.skipIf(!dbAvailable)('tender rules', () => {
  afterAll(async () => {
    // Publishing floats the contract (by design), which would consume the
    // only DRAFT fixture the probe above relies on. Reset the fixture back
    // to its pre-test state so repeat runs keep exercising the real rule
    // instead of silently skipping on the next invocation.
    await pool.query(`delete from eworks.tender_corrigenda where notice_id in (select id from eworks.tender_notices where contract_id=$1)`, [contract.id]);
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
    await pool.query(`update eworks.contracts set status='DRAFT' where id=$1`, [contract.id]);
  });

  it('publish is blocked without a sanction, allowed after, and floats the contract', async () => {
    // Cleanup of prior fixture rows runs via the raw pool (not the RLS-guarded
    // eworks_authenticated role) — eworks_authenticated no longer holds DELETE
    // on these tables (see Fix 2: the DELETE grant was a production hole).
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
    await withUserSession(officer.userId, async (client) => {
      // fresh notice on the DRAFT contract (clean any prior)
      const n = await client.query(
        `insert into eworks.tender_notices (contract_id, notice_no, scope_summary, estimated_value_paise, completion_period_days, emd_amount_paise, created_by)
         values ($1,'NIT-TEST','scope',100000,90,5000, eworks.current_user_id()) returning id`, [contract.id]);
      const noticeId = n.rows[0].id;
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

  it('record_sanction rejects a user without contract.manage over the contract', async () => {
    const outsider = await pool.query(
      `select owner_user_id as "userId" from eworks.contractors where owner_user_id is not null limit 1`);
    const outsiderId = outsider.rows[0]?.userId;
    expect(outsiderId, 'expected a contractor owner_user_id fixture to test against').toBeTruthy();
    await withUserSession(outsiderId, async (client) => {
      await expect(client.query(`select eworks.record_sanction($1, 1000, 'X')`, [contract.id]))
        .rejects.toThrow(/authorized/i);
    });
  }, 15000);
});

describe.skipIf(!dbAvailable)('tender end-to-end flow', () => {
  afterAll(async () => {
    // The flow floats the contract (publish does this by design) and leaves
    // its own notice/sanction/criteria behind. Reset the fixture so re-runs
    // keep exercising the full path instead of silently skipping on the
    // next invocation (same reasoning as the 'tender rules' afterAll above).
    await pool.query(`delete from eworks.tender_corrigenda where notice_id in (select id from eworks.tender_notices where contract_id=$1)`, [contract.id]);
    await pool.query(`delete from eworks.tender_eligibility_criteria where notice_id in (select id from eworks.tender_notices where contract_id=$1)`, [contract.id]);
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
    await pool.query(`update eworks.contracts set status='DRAFT' where id=$1`, [contract.id]);
  });

  it('sanction -> notice + criteria -> publish surfaces on the public board/detail and is audited', async () => {
    // Clean any prior notice/sanction for this contract (via the raw pool,
    // same reasoning as the 'tender rules' block: eworks_authenticated no
    // longer holds DELETE on these tables).
    await pool.query(`delete from eworks.tender_eligibility_criteria where notice_id in (select id from eworks.tender_notices where contract_id=$1)`, [contract.id]);
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);

    const before = await pool.query(
      `select count(*)::int as c from eworks.audit_logs where action in ('tender.sanction','tender.publish')`);

    let noticeId;
    await withUserSession(officer.userId, async (client) => {
      const n = await client.query(
        `insert into eworks.tender_notices (contract_id, notice_no, scope_summary, estimated_value_paise, completion_period_days, emd_amount_paise, created_by)
         values ($1,'NIT-FLOW','flow scope',250000000,120,750000, eworks.current_user_id()) returning id`, [contract.id]);
      noticeId = n.rows[0].id;
      const criteria = [
        { label: 'Annual turnover >= sanctioned amount', kind: 'financial' },
        { label: 'Similar civil work experience', kind: 'experience' },
        { label: 'Valid PWD licence class I', kind: 'general' },
      ];
      for (let seq = 0; seq < criteria.length; seq += 1) {
        await client.query(
          `insert into eworks.tender_eligibility_criteria (notice_id, seq, label, description, kind) values ($1,$2,$3,'',$4)`,
          [noticeId, seq, criteria[seq].label, criteria[seq].kind]);
      }
      await client.query(`select eworks.record_sanction($1, 260000000, 'GO-FLOW')`, [contract.id]);
      await client.query(`select eworks.publish_tender_notice($1)`, [noticeId]);
    });

    const board = await publicTenderBoard(pool);
    expect(board.some((r) => r.noticeId === noticeId)).toBe(true);

    const detail = await publicTenderDetail(pool, noticeId);
    expect(detail).not.toBeNull();
    expect(detail.id).toBe(noticeId);
    expect(detail.criteria.length).toBe(3);

    const after = await pool.query(
      `select count(*)::int as c from eworks.audit_logs where action in ('tender.sanction','tender.publish')`);
    expect(after.rows[0].c).toBeGreaterThan(before.rows[0].c);
  }, 15000);
});

describe.skipIf(!dbAvailable)('corrigendum multi-date consolidated UPDATE (Fix 1)', () => {
  afterAll(async () => {
    // Publishing (required to exercise a "published notice", per the corrigendum
    // guard) floats the contract, same as the other describes above — reset the
    // shared WT-DRAFT-1 fixture back to DRAFT with no sanction/notice.
    await pool.query(`delete from eworks.tender_corrigenda where notice_id in (select id from eworks.tender_notices where contract_id=$1)`, [contract.id]);
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
    await pool.query(`update eworks.contracts set status='DRAFT' where id=$1`, [contract.id]);
  });

  it('applying all shifted dates in one UPDATE succeeds even though the naive per-column sequence would violate the ordering CHECK', async () => {
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);

    let noticeId;
    await withUserSession(officer.userId, async (client) => {
      const n = await client.query(
        `insert into eworks.tender_notices (contract_id, notice_no, scope_summary, estimated_value_paise,
           completion_period_days, emd_amount_paise, submission_close_at, technical_opening_at, financial_opening_at, created_by)
         values ($1,'NIT-CORRIGENDUM','scope',100000,90,5000,'2026-01-01T00:00:00Z','2026-01-10T00:00:00Z','2026-01-15T00:00:00Z',
           eworks.current_user_id()) returning id`, [contract.id]);
      noticeId = n.rows[0].id;
      await client.query(`select eworks.record_sanction($1, 120000, 'GO-CORR')`, [contract.id]);
      await client.query(`select eworks.publish_tender_notice($1)`, [noticeId]);

      // Documents the bug: shifting submission_close_at forward ALONE, while
      // technical_opening_at is still at its original (now earlier) value,
      // violates tender_notice_dates_ordered — this is why the fix
      // consolidates every changed date into a single UPDATE.
      await client.query('savepoint before_naive_update');
      await expect(
        client.query(`update eworks.tender_notices set submission_close_at=$2 where id=$1`,
          [noticeId, '2026-02-01T00:00:00Z']),
      ).rejects.toThrow(/tender_notice_dates_ordered|check constraint/i);
      await client.query('rollback to savepoint before_naive_update');

      // The fixed handler's consolidated UPDATE: every changed date column in
      // the SAME statement, so the CHECK only ever sees the final, valid state.
      await expect(
        client.query(
          `update eworks.tender_notices set submission_close_at=$2, technical_opening_at=$3, financial_opening_at=$4 where id=$1`,
          [noticeId, '2026-02-01T00:00:00Z', '2026-02-10T00:00:00Z', '2026-02-15T00:00:00Z'],
        ),
      ).resolves.not.toThrow();
    });

    const row = await pool.query(
      `select submission_close_at as "submissionCloseAt", technical_opening_at as "technicalOpeningAt",
              financial_opening_at as "financialOpeningAt"
         from eworks.tender_notices where id=$1`, [noticeId]);
    expect(row.rows[0].submissionCloseAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(row.rows[0].technicalOpeningAt.toISOString()).toBe('2026-02-10T00:00:00.000Z');
    expect(row.rows[0].financialOpeningAt.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  }, 15000);
});

describe.skipIf(!dbAvailable)('POST /api/gov/tenders/:contractId/notice — 409 on non-editable published notice (Fix 3)', () => {
  let server, base, cookieFor;

  beforeAll(async () => {
    const { createApp } = await import('./bff.mjs');
    const { loadConfig } = await import('./env.mjs');
    const { setSessionCookie } = await import('./security.mjs');
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
    // This block floats the contract by publishing — reset the shared
    // WT-DRAFT-1 fixture back to DRAFT with no sanction/notice, same as the
    // other describes in this file.
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
    await pool.query(`update eworks.contracts set status='DRAFT' where id=$1`, [contract.id]);
  });

  async function api(userId, method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie: cookieFor(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it('editing a DRAFT notice still returns 200 and persists changes (happy path preserved)', async () => {
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);

    const createRes = await api(officer.userId, 'POST', `/api/gov/tenders/${contract.id}/notice`, {
      noticeNo: 'NIT-DRAFT-EDIT', scopeSummary: 'scope v1', estimatedValuePaise: 100000,
      completionPeriodDays: 90, emdAmountPaise: 5000,
    });
    expect(createRes.status).toBe(200);

    const editRes = await api(officer.userId, 'POST', `/api/gov/tenders/${contract.id}/notice`, {
      noticeNo: 'NIT-DRAFT-EDIT', scopeSummary: 'scope v2', estimatedValuePaise: 200000,
      completionPeriodDays: 90, emdAmountPaise: 5000,
    });
    expect(editRes.status).toBe(200);

    const row = await pool.query(`select scope_summary as "scopeSummary" from eworks.tender_notices where contract_id=$1`, [contract.id]);
    expect(row.rows[0].scopeSummary).toBe('scope v2');
  }, 15000);

  it('editing an already-PUBLISHED notice returns 409 instead of a silent 200, and leaves the row untouched', async () => {
    await pool.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
    await pool.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);

    const createRes = await api(officer.userId, 'POST', `/api/gov/tenders/${contract.id}/notice`, {
      noticeNo: 'NIT-409TEST', scopeSummary: 'scope', estimatedValuePaise: 100000,
      completionPeriodDays: 90, emdAmountPaise: 5000,
    });
    expect(createRes.status).toBe(200);

    await withUserSession(officer.userId, async (client) => {
      await client.query(`select eworks.record_sanction($1, 120000, 'GO-409')`, [contract.id]);
      const n = await client.query(`select id from eworks.tender_notices where contract_id=$1`, [contract.id]);
      await client.query(`select eworks.publish_tender_notice($1)`, [n.rows[0].id]);
    });

    const editRes = await api(officer.userId, 'POST', `/api/gov/tenders/${contract.id}/notice`, {
      noticeNo: 'NIT-409TEST-EDIT', scopeSummary: 'changed scope', estimatedValuePaise: 999,
      completionPeriodDays: 90, emdAmountPaise: 5000,
    });
    expect(editRes.status).toBe(409);
    expect(editRes.body.error).toBe('notice_not_editable');

    const row = await pool.query(`select scope_summary as "scopeSummary" from eworks.tender_notices where contract_id=$1`, [contract.id]);
    expect(row.rows[0].scopeSummary).toBe('scope'); // rejected edit never touched the row
  }, 15000);
});

// Runs exactly once, regardless of describe declaration order, since it's
// registered at file scope rather than inside either describe above.
afterAll(async () => {
  await probe.end();
  if (pool) await pool.end();
});
