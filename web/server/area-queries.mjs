// Shared subtree aggregation.
//
// Both GET /api/gov/dashboard/map and GET /api/gov/area/:id read region health
// from here, so their KPI definitions cannot drift apart (build spec §4). Every
// query takes an already-resolved anchor ltree path and runs on a client that
// is already inside withUserSession — RLS is the scope gate, not these queries.

import { assembleRegions, bucketOrdersByRegion, scoreFromHealthCounts } from './region-health.mjs';

/**
 * Regions = the anchor's immediate child org units. Every one appears, even
 * with zero orders — the RLS policy (org_units_read) allows subtree reads on
 * the same session client.
 */
export async function loadChildRegions(client, anchorPath) {
  const childrenQ = await client.query(
    `select id, name from eworks.org_units
      where path <@ $1::ltree and nlevel(path) = nlevel($1::ltree) + 1
      order by name`,
    [anchorPath]);
  const children = childrenQ.rows;

  // Orders in the subtree, tagged with their immediate-child region path.
  const ordersQ = await client.query(
    `select
       child.id   as "regionId",
       child.name as "regionName",
       o.status, o.required_by as "requiredBy",
       (select count(*)::int from eworks.escalations e
         where e.order_id = o.id and e.status = 'OPEN') as "openEscalations",
       pay.status as "paymentStatus",
       coalesce(cert.signature_verified, false) as "certVerified",
       (select count(*)::int from eworks.samples s
          join eworks.test_jobs j on j.id = s.job_id where j.order_id = o.id) as "sampleCount",
       (select count(*)::int from eworks.test_results r
          join eworks.test_jobs j on j.id = r.job_id where j.order_id = o.id) as "resultCount",
       (select bool_and(r.passed) from eworks.test_results r
          join eworks.test_jobs j on j.id = r.job_id where j.order_id = o.id) as "allPassed"
     from eworks.test_orders o
     join eworks.org_units ou on ou.id = o.org_unit_id
     join eworks.org_units child
       on child.path = subltree(ou.path, 0, nlevel($1::ltree) + 1)
     left join eworks.test_jobs j on j.order_id = o.id
     left join eworks.payments pay on pay.order_id = o.id
     left join eworks.certificates cert on cert.job_id = j.id
    where o.status <> 'CANCELLED'
      and ou.path <@ $1::ltree
      -- excludes orders attached directly to the anchor org unit itself
      -- (there is no immediate-child bucket to roll those up into).
      and nlevel(ou.path) > nlevel($1::ltree)`,
    [anchorPath]);

  const bucketsById = bucketOrdersByRegion(ordersQ.rows);

  // KPIs per region (subtree-scoped, 30d window). openOrders is derived
  // in JS from the health bucket (see assembleRegions) — test_orders.status
  // has no terminal "done" value, so a SQL status filter can't tell settled
  // orders from open ones.
  const kpiQ = await client.query(
    `select
       child.id as "regionId",
       count(distinct j.id) filter (where j.status is not null
          and j.status <> 'COMPLETE' and j.status <> 'CANCELLED')::int as "activeJobs",
       count(distinct r.id) filter (where r.passed = false
          and r.entered_at >= now() - interval '30 days')::int as "failedTests30d",
       count(distinct c.id) filter (where c.issued_at >= now() - interval '30 days')::int as "certificates30d",
       count(distinct oa.vendor_id)::int as "vendorsActive"
     from eworks.test_orders o
     join eworks.org_units ou on ou.id = o.org_unit_id
     join eworks.org_units child
       on child.path = subltree(ou.path, 0, nlevel($1::ltree) + 1)
     left join eworks.test_jobs j on j.order_id = o.id
     left join eworks.test_results r on r.job_id = j.id
     left join eworks.certificates c on c.job_id = j.id
     left join eworks.order_award oa on oa.order_id = o.id
    where o.status <> 'CANCELLED'
      and ou.path <@ $1::ltree
      and nlevel(ou.path) > nlevel($1::ltree)
    group by child.id`,
    [anchorPath]);
  const kpisById = new Map(kpiQ.rows.map((k) => [k.regionId, k]));

  return assembleRegions(children, bucketsById, kpisById);
}

/**
 * Descend from `nodeId` while the current node has exactly one child.
 *
 * Returns the whole chain (hops ascending); the caller passes it to
 * pickEffectiveNode. An empty result means the node does not exist *or* is out
 * of the caller's scope — in_scope() is applied to the anchor row, and the two
 * cases are deliberately indistinguishable so the endpoint cannot be used to
 * probe for node existence.
 *
 * hops < 8 bounds the walk at the depth of eworks.org_level, so a malformed
 * tree cannot spin here.
 */
export async function loadCollapseChain(client, nodeId) {
  const q = await client.query(
    `with recursive chain as (
       select ou.id, ou.parent_id as "parentId", ou.level, ou.name,
              ou.path::text as path, 0 as hops
         from eworks.org_units ou
        where ou.id = $1 and eworks.in_scope(ou.path)
       union all
       select c.id, c.parent_id, c.level, c.name, c.path::text, chain.hops + 1
         from chain
         join eworks.org_units c on c.parent_id = chain.id
        where chain.level <> 'PROJECT'
          and chain.hops < 8
          and (select count(*) from eworks.org_units s where s.parent_id = chain.id) = 1
     )
     select * from chain order by hops`,
    [nodeId]);
  return q.rows;
}

/** Ancestors of `path`, inclusive, root-first — the breadcrumb source. */
export async function loadAncestors(client, path) {
  const q = await client.query(
    `select id, name, level, path::text as path
       from eworks.org_units
      where path @> $1::ltree
      order by nlevel(path)`,
    [path]);
  return q.rows;
}

/** Projects (level='PROJECT') directly under `path`, with stage progress. */
export async function loadProjects(client, path) {
  const q = await client.query(
    `select
       ou.id, ou.name,
       (select count(*)::int from eworks.project_test_requirements ptr
         where ptr.project_id = ou.id) as "requiredTests",
       (select count(distinct c.id)::int
          from eworks.test_orders o
          join eworks.test_jobs j on j.order_id = o.id
          join eworks.certificates c on c.job_id = j.id
         where o.org_unit_id = ou.id and c.signature_verified) as "certifiedTests",
       (select count(*)::int from eworks.test_orders o
         where o.org_unit_id = ou.id and o.status <> 'CANCELLED') as "openOrders"
     from eworks.org_units ou
    where ou.path <@ $1::ltree
      and nlevel(ou.path) = nlevel($1::ltree) + 1
      and ou.level = 'PROJECT'
    order by ou.name`,
    [path]);
  return q.rows;
}

/**
 * Whole-subtree totals for the anchor itself, for the Area summary strip.
 *
 * Deliberately counts the entire subtree including orders attached directly to
 * the anchor — unlike loadChildRegions, which can only bucket orders that sit
 * under some immediate child.
 */
export async function loadSubtreeSummary(client, anchorPath) {
  const ordersQ = await client.query(
    `select
       o.status,
       (select count(*)::int from eworks.escalations e
         where e.order_id = o.id and e.status = 'OPEN') as "openEscalations",
       pay.status as "paymentStatus",
       coalesce(cert.signature_verified, false) as "certVerified",
       (select count(*)::int from eworks.samples s
          join eworks.test_jobs j on j.id = s.job_id where j.order_id = o.id) as "sampleCount",
       (select count(*)::int from eworks.test_results r
          join eworks.test_jobs j on j.id = r.job_id where j.order_id = o.id) as "resultCount",
       (select bool_and(r.passed) from eworks.test_results r
          join eworks.test_jobs j on j.id = r.job_id where j.order_id = o.id) as "allPassed"
     from eworks.test_orders o
     join eworks.org_units ou on ou.id = o.org_unit_id
     left join eworks.test_jobs j on j.order_id = o.id
     left join eworks.payments pay on pay.order_id = o.id
     left join eworks.certificates cert on cert.job_id = j.id
    where o.status <> 'CANCELLED'
      and ou.path <@ $1::ltree`,
    [anchorPath]);

  // One synthetic bucket for the whole subtree.
  const buckets = bucketOrdersByRegion(
    ordersQ.rows.map((row) => ({ ...row, regionId: 'subtree' })),
  ).get('subtree') ?? { green: 0, amber: 0, red: 0, neutral: 0 };

  const kpiQ = await client.query(
    `select
       count(distinct j.id) filter (where j.status is not null
          and j.status <> 'COMPLETE' and j.status <> 'CANCELLED')::int as "activeJobs",
       count(distinct r.id) filter (where r.passed = false
          and r.entered_at >= now() - interval '30 days')::int as "failedTests30d",
       count(distinct c.id) filter (where c.issued_at >= now() - interval '30 days')::int as "certificates30d"
     from eworks.test_orders o
     join eworks.org_units ou on ou.id = o.org_unit_id
     left join eworks.test_jobs j on j.order_id = o.id
     left join eworks.test_results r on r.job_id = j.id
     left join eworks.certificates c on c.job_id = j.id
    where o.status <> 'CANCELLED'
      and ou.path <@ $1::ltree`,
    [anchorPath]);
  const k = kpiQ.rows[0] ?? {};

  // vendors.org_unit_id is the vendor's registering district, so the approval
  // queue is genuinely subtree-scoped: a Coimbatore officer sees Coimbatore's.
  const approvalsQ = await client.query(
    `select count(*)::int as "pendingApprovals"
       from eworks.vendors v
       join eworks.org_units ou on ou.id = v.org_unit_id
      where ou.path <@ $1::ltree and v.status = 'SUBMITTED'`,
    [anchorPath]);

  return {
    openOrders: buckets.amber + buckets.red + buckets.neutral,
    activeJobs: k.activeJobs ?? 0,
    failedTests30d: k.failedTests30d ?? 0,
    certificates30d: k.certificates30d ?? 0,
    pendingApprovals: approvalsQ.rows[0]?.pendingApprovals ?? 0,
    qualityScore: scoreFromHealthCounts(buckets),
  };
}
