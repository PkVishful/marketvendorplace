// Pure shaping for the test checklist screens. No DB, no Express — trivially
// testable. The endpoint in bff.mjs feeds these functions flat query rows.

const DOMAIN_SLUGS = {
  SOIL_GEOTECH: 'soil',
  CONCRETE: 'concrete',
  CEMENT: 'cement',
  AGGREGATE: 'aggregate',
  WATER: 'water',
  STEEL_REBAR: 'steel',
  MASONRY: 'masonry',
  BITUMEN_ROAD: 'road/bitumen',
  WATERPROOFING_FINISHES: 'waterproofing',
  ELECTRICAL: 'electrical',
  PLUMBING_FIRE_HVAC: 'plumbing',
};

export function domainSlug(domain) {
  return DOMAIN_SLUGS[domain] ?? String(domain ?? '').toLowerCase();
}

// The two tests that belong to no single build stage — they gate the whole job.
const CROSS_STAGE_CODES = new Set(['CONCRETE_MIX_DESIGN', 'WATER_QUALITY']);

// frequency_type (+ tiered spec) -> { key, params }. Client renders t(key, params).
export function frequencyLabel(frequencyType, frequencySpec = {}) {
  const spec = frequencySpec || {};
  if (frequencyType === 'ONCE') {
    return { key: 'catalog.freq.ONCE', params: {} };
  }
  if (frequencyType === 'PER_VOLUME' && Array.isArray(spec.tiers)) {
    // The IS 456 cube ladder — summarised, the tiers themselves stay in data.
    return { key: 'catalog.freq.PER_VOLUME_IS456', params: { unit: spec.unit ?? 'm3' } };
  }
  const params = {};
  if (spec.samples != null) params.samples = spec.samples;
  if (spec.unit != null) params.unit = spec.unit;
  return { key: `catalog.freq.${frequencyType}`, params };
}

function toTest(row, repeatCounts) {
  return {
    code: row.testCode,
    name: row.testName,
    domain: domainSlug(row.domain),
    isCode: row.isCode ?? null,
    requiresNabl: Boolean(row.requiresNabl),
    tatDays: row.tatDays ?? null,
    frequency: frequencyLabel(row.frequencyType, row.frequencySpec),
    repeatsAcrossStages: (repeatCounts.get(row.testCode)?.size ?? 0) > 1,
  };
}

export function shapeChecklist(rows) {
  // How many distinct stages each test appears under (drives "repeats").
  const repeatCounts = new Map();
  for (const r of rows) {
    if (!repeatCounts.has(r.testCode)) repeatCounts.set(r.testCode, new Set());
    repeatCounts.get(r.testCode).add(r.stageCode);
  }

  // Group by stageCode in first-seen order. The endpoint orders rows by
  // cs.sequence, so first-seen order is sequence order; keying by code (rather
  // than relying on row adjacency) keeps a stage's tests together even if the
  // rows arrive interleaved.
  const byStage = new Map();
  const crossStage = [];
  const seenCross = new Set();

  for (const r of rows) {
    if (CROSS_STAGE_CODES.has(r.testCode)) {
      if (!seenCross.has(r.testCode)) {
        seenCross.add(r.testCode);
        crossStage.push(toTest(r, repeatCounts));
      }
      continue;
    }
    if (!byStage.has(r.stageCode)) {
      byStage.set(r.stageCode, { code: r.stageCode, sequence: r.sequence, name: r.stageName, tests: [] });
    }
    byStage.get(r.stageCode).tests.push(toTest(r, repeatCounts));
  }

  return { stages: [...byStage.values()], crossStage };
}
