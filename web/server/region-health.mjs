// Pure region-health scoring. No SQL, no Express, no imports from bff.mjs.
//
// These live in their own module because both the dashboard map endpoint and
// the area drill-down endpoint aggregate the same way, and both need these
// functions. Keeping them here (rather than in bff.mjs, which imports the query
// layer) is what stops bff.mjs <-> area-queries.mjs becoming an import cycle.

export function computeMilestoneHealth(row) {
  if (row.status === 'FAILED' || row.openEscalations > 0) return 'red';
  if (row.paymentStatus === 'RELEASED') return 'green';
  if (
    row.status === 'AWARDED' &&
    row.certVerified &&
    row.sampleCount > 0 &&
    row.resultCount >= row.sampleCount &&
    row.allPassed === true
  ) {
    return 'green';
  }
  if (row.status === 'DRAFT' || row.status === 'FLOATED' || row.status === 'REVEALING') {
    return 'neutral';
  }
  if (row.status === 'AWARDED') return 'amber';
  return 'neutral';
}

// Region score = weighted pass ratio over settled orders (neutral = no signal).
export function scoreFromHealthCounts({ green, amber, red }) {
  const denom = green + amber + red;
  if (denom === 0) return null;
  return Math.round((100 * (green + 0.5 * amber)) / denom);
}

// Pure: build the regions[] contract from the caller's immediate children plus
// the (possibly sparse) health-bucket and KPI lookups. Every child appears —
// one with no settled orders gets score:null and all-zero KPIs, it never
// vanishes just because the orders query never touched it.
export function assembleRegions(children, bucketsById, kpisById) {
  return children.map((child) => {
    const b = bucketsById.get(child.id);
    const bucket = b ?? { green: 0, amber: 0, red: 0, neutral: 0 };
    const k = kpisById.get(child.id) ?? {};
    const openOrders = bucket.amber + bucket.red + bucket.neutral;
    return {
      id: child.id,
      name: child.name,
      score: scoreFromHealthCounts(bucket),
      kpis: {
        openOrders,
        activeJobs: k.activeJobs ?? 0,
        failedTests30d: k.failedTests30d ?? 0,
        certificates30d: k.certificates30d ?? 0,
        vendorsActive: k.vendorsActive ?? 0,
      },
    };
  });
}

/** Roll a set of order rows into {green,amber,red,neutral} counts per region. */
export function bucketOrdersByRegion(rows) {
  const bucketsById = new Map();
  for (const row of rows) {
    const b = bucketsById.get(row.regionId) ?? { green: 0, amber: 0, red: 0, neutral: 0 };
    b[computeMilestoneHealth(row)] += 1;
    bucketsById.set(row.regionId, b);
  }
  return bucketsById;
}
