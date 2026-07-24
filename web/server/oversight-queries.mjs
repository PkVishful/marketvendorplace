// Money rollups for the Tenders & Budget oversight screen. Every function takes
// a `client` already inside withUserSession(), so RLS scopes the rows — no manual
// org filtering. bigints are returned as JS numbers (paise fit in a double for
// this app's magnitudes).
import { computeSavings, isBiddingClosed } from './oversight-finance.mjs';

const n = (v) => (v == null ? 0 : Number(v));

export async function financeSummary(client) {
  const totalsQ = await client.query(`
    select
      count(*) filter (where o.status in ('FLOATED','REVEALING'))::int          as "floatedCount",
      coalesce(sum(o.estimated_amount_paise)
        filter (where o.status in ('FLOATED','REVEALING')), 0)::bigint          as "floatedEstimatePaise",
      (select count(*)::int from eworks.order_bids)                             as "bidsReceived",
      coalesce(sum(oa.price_paise), 0)::bigint                                  as "awardedValuePaise",
      coalesce((select sum(amount_paise) from eworks.payments where status='HELD'), 0)::bigint     as "paymentsHeldPaise",
      coalesce((select sum(amount_paise) from eworks.payments where status='RELEASED'), 0)::bigint as "paymentsReleasedPaise",
      coalesce(sum(coalesce(oa.price_paise, o.estimated_amount_paise))
        filter (where o.status in ('FAILED','CANCELLED')), 0)::bigint          as "failedValuePaise",
      (select count(*)::int from eworks.escalations where status='OPEN')        as "openEscalations"
    from eworks.test_orders o
    left join eworks.order_award oa on oa.order_id = o.id
  `);
  const savingsQ = await client.query(`
    select o.estimated_amount_paise as "estimatePaise", oa.price_paise as "awardPaise"
      from eworks.test_orders o
      join eworks.order_award oa on oa.order_id = o.id
     where o.estimated_amount_paise is not null
  `);
  const t = totalsQ.rows[0];
  const savings = computeSavings(savingsQ.rows);
  return {
    floatedCount: n(t.floatedCount),
    floatedEstimatePaise: n(t.floatedEstimatePaise),
    bidsReceived: n(t.bidsReceived),
    awardedValuePaise: n(t.awardedValuePaise),
    estimatedPaise: savings.estimatedPaise,
    awardedPaise: savings.awardedPaise,
    savingsPaise: savings.savingsPaise,
    paymentsHeldPaise: n(t.paymentsHeldPaise),
    paymentsReleasedPaise: n(t.paymentsReleasedPaise),
    failedValuePaise: n(t.failedValuePaise),
    openEscalations: n(t.openEscalations),
  };
}

export async function financeDistricts(client) {
  // Group each order under its DISTRICT-level ancestor. RLS already limits which
  // org_units / orders are visible, so a district officer sees only their row.
  const q = await client.query(`
    select
      d.id                                                          as "districtId",
      d.name                                                        as "district",
      count(*) filter (where o.status in ('FLOATED','REVEALING'))::int as "floatedCount",
      coalesce(sum(oa.price_paise), 0)::bigint                      as "awardedValuePaise",
      coalesce(sum(o.estimated_amount_paise)
        filter (where oa.price_paise is not null), 0)::bigint       as "estimatedForAwardedPaise",
      coalesce(sum(oa.price_paise)
        filter (where o.estimated_amount_paise is not null), 0)::bigint as "awardedWithEstPaise",
      coalesce((sum(pay.amount_paise) filter (where pay.status='HELD')), 0)::bigint     as "paymentsHeldPaise",
      coalesce((sum(pay.amount_paise) filter (where pay.status='RELEASED')), 0)::bigint as "paymentsReleasedPaise",
      coalesce(sum(coalesce(oa.price_paise, o.estimated_amount_paise))
        filter (where o.status in ('FAILED','CANCELLED')), 0)::bigint as "failedValuePaise"
    from eworks.test_orders o
    join eworks.org_units d
      on d.level = 'DISTRICT' and d.path @> (select ou.path from eworks.org_units ou where ou.id = o.org_unit_id)
    left join eworks.order_award oa on oa.order_id = o.id
    left join eworks.payments pay on pay.order_id = o.id
    group by d.id, d.name
    order by d.name
  `);
  return q.rows.map((r) => ({
    districtId: r.districtId,
    district: r.district,
    floatedCount: n(r.floatedCount),
    awardedValuePaise: n(r.awardedValuePaise),
    savingsPaise: n(r.estimatedForAwardedPaise) - n(r.awardedWithEstPaise),
    paymentsHeldPaise: n(r.paymentsHeldPaise),
    paymentsReleasedPaise: n(r.paymentsReleasedPaise),
    failedValuePaise: n(r.failedValuePaise),
  }));
}

export async function financeOrders(client, { limit = 20, offset = 0, district = null } = {}) {
  const totalQ = await client.query(`
    select count(*)::int as total
      from eworks.test_orders o
      join eworks.org_units ou on ou.id = o.org_unit_id
     where ($1::text is null or exists (
             select 1 from eworks.org_units d
              where d.level='DISTRICT' and d.path @> ou.path and d.name = $1))
  `, [district]);
  const q = await client.query(`
    select
      o.id, o.milestone, o.status,
      ou.name                          as "orgName",
      o.estimated_amount_paise         as "estimatePaise",
      (select count(*)::int from eworks.order_bids b where b.order_id = o.id) as "bidCount",
      oa.price_paise                   as "awardPaise",
      av.legal_name                    as "awardedVendor",
      (select pay.status from eworks.payments pay where pay.order_id = o.id order by pay.created_at desc limit 1) as "paymentStatus"
    from eworks.test_orders o
    join eworks.org_units ou on ou.id = o.org_unit_id
    left join eworks.order_award oa on oa.order_id = o.id
    left join eworks.vendors av on av.id = oa.vendor_id
    where ($3::text is null or exists (
            select 1 from eworks.org_units d
             where d.level='DISTRICT' and d.path @> ou.path and d.name = $3))
    order by o.created_at desc
    limit $1 offset $2
  `, [limit, offset, district]);
  const rows = q.rows.map((r) => {
    const closed = isBiddingClosed(r.status);
    return {
      id: r.id,
      milestone: r.milestone,
      orgName: r.orgName,
      status: r.status,
      estimatePaise: r.estimatePaise == null ? null : Number(r.estimatePaise),
      bidCount: Number(r.bidCount),
      // Award only ever exists post-close, but gate defensively anyway.
      awardPaise: closed && r.awardPaise != null ? Number(r.awardPaise) : null,
      awardedVendor: closed ? r.awardedVendor : null,
      paymentStatus: r.paymentStatus ?? null,
    };
  });
  return { rows, total: totalQ.rows[0].total };
}

export async function financeOrderDetail(client, orderId) {
  const oQ = await client.query(`
    select o.id, o.milestone, o.status, o.estimated_amount_paise as "estimatePaise"
      from eworks.test_orders o where o.id = $1
  `, [orderId]);
  if (oQ.rowCount === 0) return null;
  const o = oQ.rows[0];
  const sealed = !isBiddingClosed(o.status);

  const bidCount = Number((await client.query(
    `select count(*)::int as c from eworks.order_bids where order_id = $1`, [orderId])).rows[0].c);

  // Amounts ONLY when bidding has closed. When sealed we never even SELECT the
  // revealed column — the contract is "no plaintext exists yet".
  let bids = [];
  let award = null;
  let payment = null;
  let certificateId = null;
  if (!sealed) {
    const bidsQ = await client.query(`
      select v.legal_name as "vendorName", b.revealed_price_paise as "pricePaise", b.revealed_at as "revealedAt"
        from eworks.order_bids b
        join eworks.vendors v on v.id = b.vendor_id
       where b.order_id = $1 and b.revealed_price_paise is not null
       order by b.revealed_price_paise asc
    `, [orderId]);
    bids = bidsQ.rows.map((r) => ({
      vendorName: r.vendorName, pricePaise: Number(r.pricePaise), revealedAt: r.revealedAt,
    }));
    const awQ = await client.query(`
      select v.legal_name as "vendorName", oa.price_paise as "pricePaise", oa.awarded_at as "awardedAt",
             oa.qualified_bid_count as "qualifiedBidCount"
        from eworks.order_award oa join eworks.vendors v on v.id = oa.vendor_id
       where oa.order_id = $1
    `, [orderId]);
    if (awQ.rowCount) {
      const a = awQ.rows[0];
      award = { vendorName: a.vendorName, pricePaise: Number(a.pricePaise), awardedAt: a.awardedAt, qualifiedBidCount: Number(a.qualifiedBidCount) };
    }
    const payQ = await client.query(`
      select status, amount_paise as "amountPaise", released_at as "releasedAt", created_at as "createdAt"
        from eworks.payments where order_id = $1 order by created_at desc limit 1
    `, [orderId]);
    if (payQ.rowCount) {
      const p = payQ.rows[0];
      payment = { status: p.status, amountPaise: Number(p.amountPaise), releasedAt: p.releasedAt, heldSince: p.createdAt };
    }
    certificateId = (await client.query(
      `select c.id from eworks.certificates c
         join eworks.test_jobs j on j.id = c.job_id
        where j.order_id = $1 limit 1`, [orderId])).rows[0]?.id ?? null;
  }
  return {
    id: o.id, milestone: o.milestone, status: o.status,
    estimatePaise: o.estimatePaise == null ? null : Number(o.estimatePaise),
    sealed, bidCount, bids, award, payment, certificateId,
  };
}

export async function financeVendors(client) {
  const q = await client.query(`
    select
      v.id                       as "vendorId",
      v.legal_name               as "vendorName",
      coalesce(sum(oa.price_paise), 0)::bigint as "awardedPaise",
      coalesce((select sum(p.amount_paise) from eworks.payments p
                 where p.vendor_id = v.id and p.status='RELEASED'), 0)::bigint as "paidPaise",
      coalesce((select sum(p.amount_paise) from eworks.payments p
                 where p.vendor_id = v.id and p.status='HELD'), 0)::bigint as "pendingPaise"
    from eworks.vendors v
    join eworks.order_award oa on oa.vendor_id = v.id
    group by v.id, v.legal_name
    order by "awardedPaise" desc
  `);
  return q.rows.map((r) => ({
    vendorId: r.vendorId, vendorName: r.vendorName,
    awardedPaise: n(r.awardedPaise), paidPaise: n(r.paidPaise), pendingPaise: n(r.pendingPaise),
  }));
}

// Advisory flags only. Threshold for "award over estimate" comes from
// eworks.settings (key 'oversight.award_over_estimate_pct'), default 15.
export async function oversightFlags(client) {
  const flags = [];

  const single = await client.query(`
    select oa.order_id as "orderId", o.milestone
      from eworks.order_award oa join eworks.test_orders o on o.id = oa.order_id
     where oa.qualified_bid_count = 1
  `);
  for (const r of single.rows) {
    flags.push({ kind: 'single_bidder', severity: 'warn', orderId: r.orderId, label: r.milestone });
  }

  const pctRow = await client.query(
    `select coalesce((select value from eworks.settings where key='oversight.award_over_estimate_pct'), '15') as pct`);
  const raw = Number(pctRow.rows[0].pct);
  const pct = Number.isFinite(raw) ? raw : 15;
  const over = await client.query(`
    select o.id as "orderId", o.milestone
      from eworks.test_orders o join eworks.order_award oa on oa.order_id = o.id
     where o.estimated_amount_paise is not null
       and oa.price_paise > o.estimated_amount_paise * (1 + $1/100.0)
  `, [pct]);
  for (const r of over.rows) {
    flags.push({ kind: 'award_over_estimate', severity: 'warn', orderId: r.orderId, label: r.milestone });
  }

  // Integrity: a released payment with no verified certificate for its order.
  // DB constraints should make this impossible, so any hit is a red alert.
  const integrity = await client.query(`
    select p.order_id as "orderId", o.milestone
      from eworks.payments p join eworks.test_orders o on o.id = p.order_id
     where p.status = 'RELEASED'
       and not exists (
         select 1 from eworks.certificates c join eworks.test_jobs j on j.id = c.job_id
          where j.order_id = p.order_id and c.signature_verified)
  `);
  for (const r of integrity.rows) {
    flags.push({ kind: 'payment_without_certificate', severity: 'integrity', orderId: r.orderId, label: r.milestone });
  }

  flags.sort((a, b) => (a.severity === 'integrity' ? 0 : 1) - (b.severity === 'integrity' ? 0 : 1));

  return flags;
}
