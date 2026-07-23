// Dev-only statewide seed: all 38 Tamil Nadu districts under the TN state node.
//
// WHY THIS EXISTS
//   The Head Admin dashboard is scope-driven and correct -- it renders whatever
//   districts RLS returns. The database simply only contained Coimbatore + Salem
//   (the two committed fixtures), so the state map had two tiles. This seed
//   builds the other 36 districts with *varied* data so the statewide map is
//   genuinely multi-coloured: some green, some amber, some red, some grey.
//
// FIDELITY (decision recorded in the Unit A design)
//   Coimbatore and Salem keep their fully-faithful field-job chains (bids ->
//   award -> job -> certificate) from seed-dev.mjs, as drill-down showcases.
//   The 36 generated districts get the *minimal honest object graph* inserted
//   directly as the table owner: real org tree, engineers, vendors, orders,
//   results and escalations -- enough for the health rollup to differ per
//   district -- but no bidding/certificate machinery.
//
//   Direct owner inserts are safe here because this runs as `postgres`
//   (bypasses RLS), and the invariant triggers on these tables fire on UPDATE,
//   not INSERT (status-transition, bid-immutability, custody-append). We still
//   respect every CHECK/FK constraint and the strict level-descent rule.
//
// SAFETY
//   The remote Supabase is shared with a separate app. assertLocalDb() hard-
//   refuses to run against anything but local Postgres.
//
// Run standalone:  node server/seed-districts.mjs   (needs EWORKS_USE_LOCAL_PG=1)
// Also invoked by: server/seed-dev.mjs

import { pool } from './db.mjs';

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------
export function assertLocalDb() {
  const remoteUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const useLocal = process.env.EWORKS_USE_LOCAL_PG === '1';
  const remoteOk = process.env.EWORKS_SEED_REMOTE_OK === '1';
  if (remoteUrl && !useLocal && !remoteOk) {
    throw new Error(
      'seed-districts: refusing to run against a remote database. The remote ' +
      'Supabase is shared with another app. Set EWORKS_USE_LOCAL_PG=1 (and a ' +
      'local PGHOST/PGPORT) to seed the local eworks database instead, or ' +
      'EWORKS_SEED_REMOTE_OK=1 to deliberately seed the remote eworks schema.',
    );
  }
}

// ---------------------------------------------------------------------------
// District registry -- all 38 TN districts with centroids (lat, lng).
// Centroids place vendors/sites now and feed the Unit C choropleth later.
// Coimbatore + Salem are `existing: true`: their org tree, users and field job
// are already seeded, so this script skips generating them (sibling code would
// collide) but keeps them here so the registry is the single list of 38.
// ---------------------------------------------------------------------------
export const TN_DISTRICTS = [
  { code: 'CHENNAI',         name: 'Chennai',         lat: 13.0827, lng: 80.2707 },
  { code: 'COIMBATORE',      name: 'Coimbatore',      lat: 11.0168, lng: 76.9558, existing: true },
  { code: 'MADURAI',         name: 'Madurai',         lat: 9.9252,  lng: 78.1198 },
  { code: 'SALEM',           name: 'Salem',           lat: 11.6643, lng: 78.1460, existing: true },
  { code: 'TIRUCHIRAPPALLI', name: 'Tiruchirappalli', lat: 10.7905, lng: 78.7047 },
  { code: 'TIRUNELVELI',     name: 'Tirunelveli',     lat: 8.7139,  lng: 77.7567 },
  { code: 'ERODE',           name: 'Erode',           lat: 11.3410, lng: 77.7172 },
  { code: 'VELLORE',         name: 'Vellore',         lat: 12.9165, lng: 79.1325 },
  { code: 'THANJAVUR',       name: 'Thanjavur',       lat: 10.7870, lng: 79.1378 },
  { code: 'KANCHIPURAM',     name: 'Kanchipuram',     lat: 12.8342, lng: 79.7036 },
  { code: 'CUDDALORE',       name: 'Cuddalore',       lat: 11.7480, lng: 79.7714 },
  { code: 'DINDIGUL',        name: 'Dindigul',        lat: 10.3624, lng: 77.9695 },
  { code: 'THOOTHUKUDI',     name: 'Thoothukudi',     lat: 8.7642,  lng: 78.1348 },
  { code: 'SIVAGANGA',       name: 'Sivaganga',       lat: 9.8433,  lng: 78.4809 },
  { code: 'VIRUDHUNAGAR',    name: 'Virudhunagar',    lat: 9.5680,  lng: 77.9624 },
  { code: 'NAMAKKAL',        name: 'Namakkal',        lat: 11.2189, lng: 78.1677 },
  { code: 'KARUR',           name: 'Karur',           lat: 10.9601, lng: 78.0766 },
  { code: 'KRISHNAGIRI',     name: 'Krishnagiri',     lat: 12.5186, lng: 78.2137 },
  { code: 'DHARMAPURI',      name: 'Dharmapuri',      lat: 12.1211, lng: 78.1583 },
  { code: 'NAGAPATTINAM',    name: 'Nagapattinam',    lat: 10.7656, lng: 79.8424 },
  { code: 'PUDUKKOTTAI',     name: 'Pudukkottai',     lat: 10.3833, lng: 78.8001 },
  { code: 'RAMANATHAPURAM',  name: 'Ramanathapuram',  lat: 9.3639,  lng: 78.8395 },
  { code: 'THENI',           name: 'Theni',           lat: 10.0104, lng: 77.4768 },
  { code: 'NILGIRIS',        name: 'The Nilgiris',    lat: 11.4916, lng: 76.7337 },
  { code: 'PERAMBALUR',      name: 'Perambalur',      lat: 11.2342, lng: 78.8807 },
  { code: 'ARIYALUR',        name: 'Ariyalur',        lat: 11.1401, lng: 79.0782 },
  { code: 'TIRUVANNAMALAI',  name: 'Tiruvannamalai',  lat: 12.2253, lng: 79.0747 },
  { code: 'TIRUVARUR',       name: 'Tiruvarur',       lat: 10.7726, lng: 79.6368 },
  { code: 'VILLUPURAM',      name: 'Villupuram',      lat: 11.9401, lng: 79.4861 },
  { code: 'KANYAKUMARI',     name: 'Kanyakumari',     lat: 8.0883,  lng: 77.5385 },
  { code: 'TIRUPPUR',        name: 'Tiruppur',        lat: 11.1085, lng: 77.3411 },
  { code: 'TIRUVALLUR',      name: 'Tiruvallur',      lat: 13.1439, lng: 79.9094 },
  { code: 'CHENGALPATTU',    name: 'Chengalpattu',    lat: 12.6819, lng: 79.9888 },
  { code: 'KALLAKURICHI',    name: 'Kallakurichi',    lat: 11.7383, lng: 78.9570 },
  { code: 'RANIPET',         name: 'Ranipet',         lat: 12.9249, lng: 79.3308 },
  { code: 'TENKASI',         name: 'Tenkasi',         lat: 8.9594,  lng: 77.3152 },
  { code: 'TIRUPATHUR',      name: 'Tirupathur',      lat: 12.4954, lng: 78.5679 },
  { code: 'MAYILADUTHURAI',  name: 'Mayiladuthurai',  lat: 11.1014, lng: 79.6583 },
];

// Health-profile assignment for the 36 generated districts. A repeating pattern
// keeps the map varied and reproducible. Per 9-district cycle: 3 green, 3 amber,
// 2 red, 1 neutral -> across 36 roughly green14 / amber11 / red7 / neutral4.
const PROFILE_CYCLE = ['green', 'amber', 'red', 'green', 'neutral', 'amber', 'green', 'red', 'amber'];

// Orders each profile produces. `AWARDED` rows optionally carry a result:
//   passed  -> a completed, passing test
//   failed  -> a confirmed failure + OPEN escalation (turns the district red)
//   pending -> awarded but awaiting results (turns the district amber)
const PROFILE_ORDERS = {
  neutral: [],
  green:   [{ status: 'AWARDED', result: 'passed' }, { status: 'AWARDED', result: 'passed' }, { status: 'FLOATED' }],
  amber:   [{ status: 'AWARDED', result: 'pending' }, { status: 'AWARDED', result: 'passed' }, { status: 'FLOATED' }],
  red:     [{ status: 'AWARDED', result: 'failed' }, { status: 'AWARDED', result: 'passed' }, { status: 'FLOATED' }, { status: 'FLOATED' }],
};

// ---------------------------------------------------------------------------
// Deterministic id / code helpers -- so re-running targets the same rows.
// UUID namespaces below never collide with the committed fixtures
// (1111.../2222.../4444.../5555.../aaaa.../bbbb.../cccc...).
// ---------------------------------------------------------------------------
const hex4 = (n) => n.toString(16).padStart(4, '0');

// mkid('0d1', i, n) -> '0d100000-<i>-<n>-0000-000000000000'
const mkid = (prefix3, i, n = 0) =>
  `${prefix3}00000-${hex4(i)}-${hex4(n)}-0000-000000000000`;

const NS = {
  district: '0d1', division: '0d2', circle: '0d3', subdivision: '0d4',
  section: '0d5', fieldUnit: '0d6', project: '0d7',
  govUser: '0e1', vendorOwner: '0e2', vendor: '0ce',
  order: '0a1', bid: '0b1', award: '0c0', job: '0c1',
  sample: '05a', result: '0f1', escalation: '0ec',
};

const QR_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // matches ^EW-[2-9A-HJ-NP-Z]{12}$
function qrCode(counter) {
  let n = counter, out = '';
  while (n > 0) { out = QR_ALPHABET[n % 32] + out; n = Math.floor(n / 32); }
  return 'EW-' + out.padStart(12, QR_ALPHABET[0]);
}

let vendorSeq = 0;
function nextGstinPan() {
  vendorSeq += 1;
  const pan = 'TNLAB' + String(vendorSeq).padStart(4, '0') + 'Z'; // [A-Z]{5}[0-9]{4}[A-Z]
  const gstin = '33' + pan + '1Z5';                                // 2 + PAN(10) + entity/Z/checksum
  return { pan, gstin };
}

const jitter = (base, i, salt) => base + (((i * 7 + salt * 13) % 20) - 10) / 100; // ±0.10°

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------
export async function seedDistricts(client) {
  await clearGenerated(client);

  const [{ id: testId }] = (await client.query(
    `select id from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH'`,
  )).rows;
  const [{ id: stageId }] = (await client.query(
    `select id from eworks.construction_stage where code = 'SUPERSTRUCTURE'`,
  )).rows;
  if (!testId || !stageId) {
    throw new Error('seed-districts: reference data missing (test catalog / construction stage). Run migrations first.');
  }

  const TN = '11111111-0000-0000-0000-000000000001';
  const generated = TN_DISTRICTS.filter((d) => !d.existing);

  let profileIdx = 0;
  const summary = [];

  for (let k = 0; k < generated.length; k++) {
    const d = generated[k];
    const i = k + 1;                       // 1-based index for id namespacing
    const profile = PROFILE_CYCLE[profileIdx++ % PROFILE_CYCLE.length];

    const ids = {
      district:   mkid(NS.district, i),
      division:   mkid(NS.division, i),
      circle:     mkid(NS.circle, i),
      subdivision:mkid(NS.subdivision, i),
      section:    mkid(NS.section, i),
      fieldUnit:  mkid(NS.fieldUnit, i),
      project:    mkid(NS.project, i),
    };

    // --- Org subtree: DISTRICT -> DIVISION -> CIRCLE -> SUBDIVISION ->
    //     SECTION -> FIELD_UNIT -> PROJECT (strict single-level descent).
    await client.query(
      `insert into eworks.org_units (id, parent_id, level, code, name) values
         ($1,  $2,  'DISTRICT',    $3,  $4),
         ($5,  $1,  'DIVISION',    $6,  $7),
         ($8,  $5,  'CIRCLE',      $9,  $10),
         ($11, $8,  'SUBDIVISION', $12, $13),
         ($14, $11, 'SECTION',     $15, $16),
         ($17, $14, 'FIELD_UNIT',  $18, $19),
         ($20, $17, 'PROJECT',     $21, $22)
       on conflict (id) do nothing`,
      [
        ids.district,    TN,               d.code,           d.name,                            // $1-$4
        ids.division,    `${d.code}_DIV1`, `${d.name} Division 1`,                              // $5-$7
        ids.circle,      `${d.code}_CIR1`, `${d.name} Circle 1`,                                // $8-$10
        ids.subdivision, `${d.code}_SD1`,  `${d.name} Subdivision 1`,                           // $11-$13
        ids.section,     `${d.code}_SEC1`, `${d.name} Section 1`,                               // $14-$16
        ids.fieldUnit,   `${d.code}_FU1`,  `${d.name} Field Unit 1`,                            // $17-$19
        ids.project,     `${d.code}_PRJ1`, `${d.name} Infrastructure Project`,                  // $20-$22
      ],
    );

    // --- Engineers: District Officer @DISTRICT, Executive Engineer @DIVISION,
    //     Site Engineer @SECTION. Real profiles + role grants -> real counts.
    const officerUser = mkid(NS.govUser, i, 0);
    const eeUser = mkid(NS.govUser, i, 1);
    const seUser = mkid(NS.govUser, i, 2);
    await client.query(
      `insert into eworks.user_profiles (id, phone, full_name) values
         ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)
       on conflict (id) do nothing`,
      [
        officerUser, govPhone(i, 0), `${d.name} District Officer`,
        eeUser,      govPhone(i, 1), `${d.name} Executive Engineer`,
        seUser,      govPhone(i, 2), `${d.name} Site Engineer`,
      ],
    );
    await client.query(
      `insert into eworks.user_roles (user_id, role_code, org_unit_id) values
         ($1, 'DISTRICT_OFFICER',   $2),
         ($3, 'EXECUTIVE_ENGINEER', $4),
         ($5, 'SITE_ENGINEER',      $6)
       on conflict on constraint user_roles_unique do nothing`,
      [officerUser, ids.district, eeUser, ids.division, seUser, ids.section],
    );

    // --- Vendors: an APPROVED worker lab, a SUBMITTED applicant (pending
    //     queue), and on some districts a third with lapsed NABL.
    const vendorSpecs = [
      { status: 'APPROVED',  nablDays: 365 },
      { status: 'SUBMITTED', nablDays: 365 },
    ];
    if (i % 3 === 0) vendorSpecs.push({ status: 'APPROVED', nablDays: -1 }); // expired NABL

    let workerVendorId = null;
    let workerOwnerId = null;
    for (let v = 0; v < vendorSpecs.length; v++) {
      const spec = vendorSpecs[v];
      const vendorId = mkid(NS.vendor, i, v);
      const ownerId = mkid(NS.vendorOwner, i, v);
      const { gstin, pan } = nextGstinPan();
      await client.query(
        `insert into eworks.user_profiles (id, phone, full_name) values ($1, $2, $3)
         on conflict (id) do nothing`,
        [ownerId, vendorPhone(i, v), `${d.name} Lab ${v + 1} Owner`],
      );
      await client.query(
        `insert into eworks.user_roles (user_id, role_code, org_unit_id) values ($1, 'LAB_VENDOR', $2)
         on conflict on constraint user_roles_unique do nothing`,
        [ownerId, ids.district],
      );
      const approved = spec.status === 'APPROVED';
      await client.query(
        `insert into eworks.vendors
           (id, owner_user_id, org_unit_id, legal_name, gstin, pan, address,
            location, service_radius_km, status, approved_by, approved_at,
            nabl_no, nabl_valid_until)
         values ($1,$2,$3,$4,$5,$6,$7,
                 st_makepoint($8,$9)::geography,$10,$11,$12,$13,$14,$15)
         on conflict (id) do nothing`,
        [
          vendorId, ownerId, ids.district,
          `${d.name} Testing Labs ${v + 1}`, gstin, pan, `${d.name}, Tamil Nadu`,
          jitter(d.lng, i, v), jitter(d.lat, i, v),
          50 + ((i + v) % 4) * 25,              // 50/75/100/125 km radius
          spec.status,
          approved ? officerUser : null,
          approved ? new Date().toISOString() : null,
          `TC-${2000 + vendorSeq}`,
          isoDatePlus(spec.nablDays),
        ],
      );
      if (approved) {
        await client.query(
          `insert into eworks.vendor_test_capabilities
             (vendor_id, test_id, is_nabl_accredited, nabl_scope_ref, accredited_from, accredited_to)
           values ($1, $2, true, $3, current_date - 365, $4)
           on conflict do nothing`,
          [vendorId, testId, `SCOPE-${d.code}-${v}`, isoDatePlus(spec.nablDays)],
        );
        await client.query(
          `insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise) values ($1, $2, $3)
           on conflict do nothing`,
          [vendorId, testId, 240000 + ((i * 500) % 40000)],
        );
      }
      // First live-NABL approved vendor is the district's worker for awards.
      if (approved && spec.nablDays > 0 && !workerVendorId) {
        workerVendorId = vendorId;
        workerOwnerId = ownerId;
      }
    }

    // --- Orders / results by profile.
    const specs = PROFILE_ORDERS[profile];
    const counts = { floated: 0, awarded: 0, passed: 0, pending: 0, failed: 0, escalations: 0 };
    for (let o = 0; o < specs.length; o++) {
      const spec = specs[o];
      const orderId = mkid(NS.order, i, o);
      const site = [jitter(d.lng, i, o + 5), jitter(d.lat, i, o + 5)];
      if (spec.status === 'FLOATED') {
        await insertOrder(client, {
          orderId, projectId: ids.project, orgUnitId: ids.section, stageId, site,
          status: 'FLOATED', createdBy: seUser, milestone: `Superstructure pour ${o + 1}`,
        });
        await addOrderItem(client, orderId, testId);
        counts.floated += 1;
        continue;
      }
      // AWARDED (+ optional result). Needs a bid + award before the job.
      await insertOrder(client, {
        orderId, projectId: ids.project, orgUnitId: ids.section, stageId, site,
        status: 'AWARDED', createdBy: seUser, milestone: `Superstructure pour ${o + 1}`,
      });
      await addOrderItem(client, orderId, testId);
      counts.awarded += 1;
      const price = 240000 + ((i + o) * 1000) % 30000;
      await awardChain(client, { orderId, vendorId: workerVendorId, bidId: mkid(NS.bid, i, o), price });

      if (spec.result === 'pending') { counts.pending += 1; continue; }

      // A completed test: job -> sample -> result (+ escalation on failure).
      const jobId = mkid(NS.job, i, o);
      const sampleId = mkid(NS.sample, i, o);
      const resultId = mkid(NS.result, i, o);
      await client.query(
        `insert into eworks.test_jobs (id, order_id, vendor_id, technician_id, status)
         values ($1, $2, $3, null, 'COMPLETE') on conflict (id) do nothing`,
        [jobId, orderId, workerVendorId],
      );
      await client.query(
        `insert into eworks.samples (id, job_id, test_id, qr_code, specimen_no, test_age_days)
         values ($1, $2, $3, $4, 1, 28) on conflict (id) do nothing`,
        [sampleId, jobId, testId, qrCode(vendorSeq * 1000 + i * 10 + o)],
      );
      const passed = spec.result === 'passed';
      const value = passed ? 30 + (i % 5) : 17 + (i % 4);
      await client.query(
        `insert into eworks.test_results
           (id, job_id, sample_id, test_id, age_days, measurements, applied_criteria,
            metric, metric_value, threshold_min, threshold_max, passed, is_provisional, entered_by)
         values ($1,$2,$3,$4,28,$5,$6,'cube_strength_mpa',$7,25,null,$8,false,$9)
         on conflict (id) do nothing`,
        [
          resultId, jobId, sampleId, testId,
          JSON.stringify({ cube_strength_mpa: value }),
          JSON.stringify({ metric: 'cube_strength_mpa', min: 25, source: 'IS 456' }),
          value, passed, workerOwnerId,
        ],
      );
      if (passed) { counts.passed += 1; }
      else {
        counts.failed += 1;
        await client.query(
          `insert into eworks.escalations (id, order_id, result_id, level, reason, status)
           values ($1, $2, $3, 'CORE_TEST', $4, 'OPEN') on conflict (id) do nothing`,
          [mkid(NS.escalation, i, o), orderId, resultId,
           `cube_strength_mpa = ${value}, required >= 25 (IS 456)`],
        );
        counts.escalations += 1;
      }
    }

    summary.push({ district: d.name, profile, ...counts });
  }

  return summary;
}

// --- small insert helpers -------------------------------------------------
function govPhone(i, r) { return '93' + String(i).padStart(4, '0') + String(r).padStart(4, '0'); }
function vendorPhone(i, v) { return '94' + String(i).padStart(4, '0') + String(v).padStart(4, '0'); }
function isoDatePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function insertOrder(client, { orderId, projectId, orgUnitId, stageId, site, status, createdBy, milestone }) {
  // FLOATED/AWARDED require a full schedule (orders_floated_has_schedule).
  // AWARDED uses past timestamps; FLOATED a still-open window.
  const schedule = status === 'FLOATED'
    ? `now() - interval '1 day', now() + interval '1 day', now() + interval '2 days'`
    : `now() - interval '10 days', now() - interval '8 days', now() - interval '7 days'`;
  await client.query(
    `insert into eworks.test_orders
       (id, project_id, org_unit_id, milestone, stage_id, site, eval_method, status,
        floated_at, bid_close_at, reveal_close_at, required_by, created_by)
     values ($1,$2,$3,$4,$5, st_makepoint($6,$7)::geography, 'L1', $8,
             ${schedule}, current_date + 30, $9)
     on conflict (id) do nothing`,
    [orderId, projectId, orgUnitId, milestone, stageId, site[0], site[1], status, createdBy],
  );
}

async function addOrderItem(client, orderId, testId) {
  await client.query(
    `insert into eworks.order_items (order_id, test_id, quantity, test_ages_days)
     values ($1, $2, 6, '{7,28}') on conflict (order_id, test_id) do nothing`,
    [orderId, testId],
  );
}

async function awardChain(client, { orderId, vendorId, bidId, price }) {
  // A revealed bid (direct insert; the immutability trigger only fires on UPDATE)
  // and the single award row the job trigger checks against.
  await client.query(
    `insert into eworks.order_bids
       (id, order_id, vendor_id, commitment, committed_at,
        revealed_price_paise, nonce, revealed_at, status)
     values ($1, $2, $3, decode(repeat('ab',32),'hex'), now() - interval '9 days',
             $4, 'seed-nonce', now() - interval '8 days', 'REVEALED')
     on conflict (id) do nothing`,
    [bidId, orderId, vendorId, price],
  );
  await client.query(
    `insert into eworks.order_award
       (order_id, bid_id, vendor_id, price_paise, eval_method, qualified_bid_count, awarded_at)
     values ($1, $2, $3, $4, 'L1', 1, now() - interval '7 days')
     on conflict (order_id) do nothing`,
    [orderId, bidId, vendorId, price],
  );
}

// Idempotency: remove everything this seed generated (by uuid namespace), in
// child-before-parent order. Never touches the committed fixtures.
async function clearGenerated(client) {
  const like = (col, ns) => `${col}::text like '${ns}%'`;
  const stmts = [
    `delete from eworks.escalations where ${like('id', NS.escalation)}`,
    `delete from eworks.test_results where ${like('id', NS.result)}`,
    `delete from eworks.samples where ${like('id', NS.sample)}`,
    `delete from eworks.test_jobs where ${like('id', NS.job)}`,
    `delete from eworks.order_award where ${like('order_id', NS.order)}`,
    `delete from eworks.order_bids where ${like('id', NS.bid)}`,
    `delete from eworks.order_items where ${like('order_id', NS.order)}`,
    `delete from eworks.test_orders where ${like('id', NS.order)}`,
    `delete from eworks.vendor_test_pricing where ${like('vendor_id', NS.vendor)}`,
    `delete from eworks.vendor_test_capabilities where ${like('vendor_id', NS.vendor)}`,
    `delete from eworks.vendors where ${like('id', NS.vendor)}`,
    `delete from eworks.user_roles where ${like('user_id', NS.govUser)} or ${like('user_id', NS.vendorOwner)}`,
    `delete from eworks.user_profiles where ${like('id', NS.govUser)} or ${like('id', NS.vendorOwner)}`,
    // org units leaf-up (parent_id is on delete restrict)
    `delete from eworks.org_units where ${like('id', NS.project)}`,
    `delete from eworks.org_units where ${like('id', NS.fieldUnit)}`,
    `delete from eworks.org_units where ${like('id', NS.section)}`,
    `delete from eworks.org_units where ${like('id', NS.subdivision)}`,
    `delete from eworks.org_units where ${like('id', NS.circle)}`,
    `delete from eworks.org_units where ${like('id', NS.division)}`,
    `delete from eworks.org_units where ${like('id', NS.district)}`,
  ];
  for (const sql of stmts) await client.query(sql);
}

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------
async function main() {
  assertLocalDb();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const summary = await seedDistricts(client);
    await client.query('commit');

    const tally = summary.reduce((acc, r) => { acc[r.profile] = (acc[r.profile] || 0) + 1; return acc; }, {});
    console.log(`Seeded ${summary.length} districts (+ Coimbatore, Salem existing = ${summary.length + 2} total).`);
    console.log('Health spread:', tally);
    console.table(summary);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('seed-districts failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run when invoked directly, not when imported by seed-dev.mjs.
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
