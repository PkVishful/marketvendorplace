// Money rollups for the Tenders & Budget oversight screen. Every function takes
// a `client` already inside withUserSession(), so RLS scopes the rows — no manual
// org filtering. bigints are returned as JS numbers (paise fit in a double for
// this app's magnitudes).
import { computeSavings } from './oversight-finance.mjs';

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
