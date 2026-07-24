// Tender queries. Authenticated views take a `client` (RLS applies). Public
// board/detail take the raw `pool` and hard-filter to PUBLISHED + public columns.
const n = (v) => (v == null ? null : Number(v));

export async function govTenderView(client, contractId) {
  const c = await client.query(`select id, code, title, value_paise as "valuePaise", status, project_id as "projectId" from eworks.contracts where id=$1`, [contractId]);
  if (c.rowCount === 0) return null;
  const s = await client.query(`select sanctioned_amount_paise as "amountPaise", order_no as "orderNo", sanctioned_at as "sanctionedAt" from eworks.sanctions where contract_id=$1`, [contractId]);
  const tn = await client.query(`select * from eworks.tender_notices where contract_id=$1`, [contractId]);
  const notice = tn.rows[0] ?? null;
  let criteria = [], corrigenda = [];
  if (notice) {
    criteria = (await client.query(`select id, seq, label, description, kind from eworks.tender_eligibility_criteria where notice_id=$1 order by seq`, [notice.id])).rows;
    corrigenda = (await client.query(`select corrigendum_no as "corrigendumNo", summary, issued_at as "issuedAt" from eworks.tender_corrigenda where notice_id=$1 order by corrigendum_no`, [notice.id])).rows;
  }
  return {
    contract: { id: c.rows[0].id, code: c.rows[0].code, title: c.rows[0].title, valuePaise: n(c.rows[0].valuePaise), status: c.rows[0].status },
    sanction: s.rows[0] ? { amountPaise: n(s.rows[0].amountPaise), orderNo: s.rows[0].orderNo, sanctionedAt: s.rows[0].sanctionedAt } : null,
    notice: notice ? shapeNotice(notice) : null,
    criteria, corrigenda: corrigenda.map((r) => ({ ...r, corrigendumNo: Number(r.corrigendumNo) })),
  };
}

function shapeNotice(row) {
  return {
    id: row.id, contractId: row.contract_id, noticeNo: row.notice_no, scopeSummary: row.scope_summary,
    estimatedValuePaise: n(row.estimated_value_paise), completionPeriodDays: row.completion_period_days,
    emdAmountPaise: n(row.emd_amount_paise), publishAt: row.publish_at, queryDeadlineAt: row.query_deadline_at,
    submissionCloseAt: row.submission_close_at, technicalOpeningAt: row.technical_opening_at,
    financialOpeningAt: row.financial_opening_at, status: row.status, publishedAt: row.published_at,
  };
}

export async function publicTenderBoard(pool) {
  const q = await pool.query(`
    select tn.id as "noticeId", tn.notice_no as "noticeNo", ct.code as "contractCode", ct.title,
           tn.scope_summary as "scopeSummary", tn.estimated_value_paise as "estimatedValuePaise",
           tn.emd_amount_paise as "emdAmountPaise", tn.submission_close_at as "submissionCloseAt",
           tn.technical_opening_at as "technicalOpeningAt"
      from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
     where tn.status='PUBLISHED'
     order by tn.submission_close_at asc nulls last, tn.published_at desc`);
  return q.rows.map((r) => ({ ...r, estimatedValuePaise: n(r.estimatedValuePaise), emdAmountPaise: n(r.emdAmountPaise) }));
}

export async function publicTenderDetail(pool, noticeId) {
  const tn = await pool.query(`
    select tn.id, tn.notice_no as "noticeNo", ct.code as "contractCode", ct.title, tn.scope_summary as "scopeSummary",
           tn.estimated_value_paise as "estimatedValuePaise", tn.completion_period_days as "completionPeriodDays",
           tn.emd_amount_paise as "emdAmountPaise", tn.publish_at as "publishAt", tn.query_deadline_at as "queryDeadlineAt",
           tn.submission_close_at as "submissionCloseAt", tn.technical_opening_at as "technicalOpeningAt",
           tn.financial_opening_at as "financialOpeningAt"
      from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
     where tn.id=$1 and tn.status='PUBLISHED'`, [noticeId]);
  if (tn.rowCount === 0) return null;
  const criteria = (await pool.query(`select seq, label, description, kind from eworks.tender_eligibility_criteria where notice_id=$1 order by seq`, [noticeId])).rows;
  const corrigenda = (await pool.query(`select corrigendum_no as "corrigendumNo", summary, issued_at as "issuedAt" from eworks.tender_corrigenda where notice_id=$1 order by corrigendum_no`, [noticeId])).rows;
  const r = tn.rows[0];
  return { ...r, estimatedValuePaise: n(r.estimatedValuePaise), emdAmountPaise: n(r.emdAmountPaise),
    criteria, corrigenda: corrigenda.map((c) => ({ ...c, corrigendumNo: Number(c.corrigendumNo) })) };
}

export async function contractorEligibility(client) {
  const own = `join eworks.contractors c on c.id = t.contractor_id and c.owner_user_id = eworks.current_user_id()`;
  const experience = (await client.query(`select t.id, t.work_name as "workName", t.client_name as "clientName", t.value_paise as "valuePaise", t.completed_on as "completedOn" from eworks.contractor_experience t ${own} order by t.created_at desc`)).rows.map((r) => ({ ...r, valuePaise: n(r.valuePaise) }));
  const machinery = (await client.query(`select t.id, t.name, t.quantity, t.capacity from eworks.contractor_machinery t ${own} order by t.created_at desc`)).rows;
  const engineers = (await client.query(`select t.id, t.name, t.qualification, t.role from eworks.contractor_engineers t ${own} order by t.created_at desc`)).rows;
  return { experience, machinery, engineers };
}
