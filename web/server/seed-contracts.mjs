// Dev-only demo seed for the contractor / material-inspection module (Phase 7).
//
// Builds a small, realistic scenario on the two "deep" districts (Coimbatore,
// Salem) so the M2-M4 screens have something to render:
//   * an APPROVED contractor per district
//   * an AWARDED contract with a BOQ (some items need a lab test, some don't)
//   * material deliveries recorded through the real record_material_delivery()
//     -- which auto-floats a test order for the testable materials
//   * one delivery approved (contractor payment held, gated on the certificate)
//     and one left RECORDED so the EE approvals screen has a live card.
//
// Idempotent + local-only. Reuses existing gov users as recorder/approver.

import { pool } from './db.mjs';
import { assertLocalDb } from './seed-districts.mjs';

// Existing fixture identities (from seed-dev-identity.sql).
const D = {
  COIMBATORE: {
    district: '11111111-0000-0000-0000-000000000002',
    project:  '11111111-0000-0000-0000-000000000008', // CBEPRJ1
    siteEng:  '22222222-0000-0000-0000-00000000000d', // SITE_ENGINEER @ CBESEC1 (recorder)
    officer:  '22222222-0000-0000-0000-00000000000b', // DISTRICT_OFFICER @ Coimbatore (approver)
  },
  SALEM: {
    district: '11111111-0000-0000-0000-000000000009',
    project:  '11111111-0000-0000-0000-000000000010', // SLMPRJ1
    // Salem has no fixture site engineer; the Coimbatore one can't record here
    // (out of scope), so we grant a recorder below.
    siteEng:  'c0a00000-0000-0000-0000-000000000031',
    officer:  '22222222-0000-0000-0000-00000000000c', // DISTRICT_OFFICER @ Salem
  },
};

// Deterministic demo ids (namespaces distinct from every other seed/fixture).
const mk = (p, n) => `${p}0000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const CONTRACTOR = (i) => mk('c0a1', i);
const CONTRACTOR_USER = (i) => mk('c0a0', i);
const CONTRACT = (i) => mk('c0b1', i);

export async function seedContracts(client) {
  // reference ids
  const { rows: [tc] } = await client.query(
    "select id from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH'");
  const { rows: [stg] } = await client.query(
    "select id from eworks.construction_stage order by sequence limit 1");
  if (!tc || !stg) throw new Error('seed-contracts: reference data missing (run migrations first).');

  const contracts = [CONTRACT(1), CONTRACT(2), CONTRACT(3)];
  const contractors = [CONTRACTOR(1), CONTRACTOR(2)];
  const contractorUsers = [CONTRACTOR_USER(1), CONTRACTOR_USER(2), D.SALEM.siteEng];

  await clearDemo(client, { contracts, contractors, contractorUsers });

  const summary = [];
  const districts = [
    { key: 'COIMBATORE', ci: 1, gstin: '33ZZABC1234A1Z1', pan: 'ZZABC1234A' },
    { key: 'SALEM',      ci: 2, gstin: '33ZZDEF5678B1Z2', pan: 'ZZDEF5678B' },
  ];

  // A dedicated recorder for Salem (site engineer at the Salem section chain).
  await client.query(
    `insert into eworks.user_profiles (id, phone, full_name) values ($1,'9500000031','Salem Site Engineer')
     on conflict (id) do nothing`, [D.SALEM.siteEng]);
  await client.query(
    `insert into eworks.user_roles (user_id, role_code, org_unit_id) values ($1,'SITE_ENGINEER','11111111-0000-0000-0000-00000000000d')
     on conflict on constraint user_roles_unique do nothing`, [D.SALEM.siteEng]); // SLMSEC1

  for (const d of districts) {
    const ctx = D[d.key];
    const contractorId = CONTRACTOR(d.ci);
    const ownerId = CONTRACTOR_USER(d.ci);
    const contractId = CONTRACT(d.ci);

    // Contractor owner user + CONTRACTOR role, then an APPROVED contractor.
    await client.query(
      `insert into eworks.user_profiles (id, phone, full_name) values ($1,$2,$3)
       on conflict (id) do nothing`,
      [ownerId, '95000000' + String(10 + d.ci), `${d.key[0]}${d.key.slice(1).toLowerCase()} Builders Owner`]);
    await client.query(
      `insert into eworks.user_roles (user_id, role_code, org_unit_id) values ($1,'CONTRACTOR',$2)
       on conflict on constraint user_roles_unique do nothing`, [ownerId, ctx.district]);
    await client.query(
      `insert into eworks.contractors
         (id, owner_user_id, org_unit_id, legal_name, gstin, pan, address, licence_class, licence_no, status, approved_by, approved_at)
       values ($1,$2,$3,$4,$5,$6,$7,'I',$8,'APPROVED',$9, now())
       on conflict (id) do nothing`,
      [contractorId, ownerId, ctx.district,
       `${d.key[0]}${d.key.slice(1).toLowerCase()} Builders Pvt Ltd`, d.gstin, d.pan,
       `${d.key[0]}${d.key.slice(1).toLowerCase()}, Tamil Nadu`, `PWD-CL1-${d.ci.toString().padStart(3,'0')}`, ctx.officer]);

    // Awarded contract + BOQ.
    await client.query(
      `insert into eworks.contracts (id, contractor_id, project_id, code, title, value_paise, status, awarded_by, awarded_at, created_by)
       values ($1,$2,$3,$4,$5,$6,'AWARDED',$7, now(), $7)
       on conflict (id) do nothing`,
      [contractId, contractorId, ctx.project, `${d.key}-CTR-001`,
       `${d.key[0]}${d.key.slice(1).toLowerCase()} Project — Civil Works`, 500000000000, ctx.officer]);

    const boq = [
      { no: 1, material: 'Cement OPC 53',   unit: 'bag', qty: 2000, rate: 35000,  test: true },
      { no: 2, material: 'Concrete M25',    unit: 'cum', qty: 500,  rate: 650000, test: true },
      { no: 3, material: 'River sand',      unit: 'cum', qty: 400,  rate: 180000, test: false },
    ];
    const boqIds = {};
    for (const b of boq) {
      const { rows: [row] } = await client.query(
        `insert into eworks.boq_items (contract_id, item_no, material, stage_id, unit, quantity, rate_paise, requires_test, test_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [contractId, b.no, b.material, stg.id, b.unit, b.qty, b.rate, b.test, b.test ? tc.id : null]);
      boqIds[b.no] = row.id;
    }

    // Record two deliveries through the real function (auto-floats tests).
    await client.query("select set_config('app.user_id',$1,true)", [ctx.siteEng]);
    const { rows: [del1] } = await client.query(
      'select * from eworks.record_material_delivery($1,$2,$3,$4,$5)',
      [boqIds[1], 1500, 11.0168, 76.9558, 'demo-device']);          // cement, testable
    const { rows: [del2] } = await client.query(
      'select * from eworks.record_material_delivery($1,$2,$3,$4,$5)',
      [boqIds[2], 300, 11.0168, 76.9558, 'demo-device']);           // concrete, testable (left pending)

    // Approve the first (officer). Payment held, gated on the certificate.
    await client.query("select set_config('app.user_id',$1,true)", [ctx.officer]);
    await client.query('select eworks.approve_material_delivery($1, true)', [del1.id]);

    summary.push({ district: d.key, contract: `${d.key}-CTR-001`, boqItems: boq.length,
      deliveries: 2, approved: 1, pendingApproval: 1 });
  }

  // A FLOATED (open-for-bids) contract in Coimbatore, so the contractor persona
  // has something to bid on. No contractor awarded yet.
  const floatId = CONTRACT(3);
  await client.query(
    `insert into eworks.contracts (id, project_id, code, title, value_paise, status, created_by)
     values ($1, $2, 'COIMBATORE-CTR-OPEN', 'Coimbatore Storm-water Drain — Open Tender', 250000000000, 'FLOATED', $3)
     on conflict (id) do nothing`,
    [floatId, D.COIMBATORE.project, D.COIMBATORE.officer]);
  await client.query(
    `insert into eworks.boq_items (contract_id, item_no, material, stage_id, unit, quantity, rate_paise, requires_test, test_id)
     values ($1, 1, 'Cement OPC 43', $2, 'bag', 1500, 34000, true, $3),
            ($1, 2, 'M-sand', $2, 'cum', 300, 160000, false, null)
     on conflict (contract_id, item_no) do nothing`,
    [floatId, stg.id, tc.id]);
  summary.push({ district: 'COIMBATORE', contract: 'COIMBATORE-CTR-OPEN', boqItems: 2,
    deliveries: 0, approved: 0, pendingApproval: 0 });

  // A deterministic DRAFT contract (works-tender Phase 1). Anchored at the
  // Coimbatore PROJECT unit, which a contract.manage officer (DISTRICT_OFFICER
  // @ Coimbatore) covers -- the tender DB tests probe for exactly this shape
  // (a DRAFT contract + its in-scope contract.manage officer) and drive the
  // sanction/publish flow against it. `on conflict (code) do nothing` keeps
  // this idempotent: once created, re-seeding never touches it, so a test
  // run that floats it (and later resets it back to DRAFT) doesn't get its
  // fixture clobbered by the next seed pass.
  const draftContractId = mk('c0b2', 1);
  await client.query(
    `insert into eworks.contracts (id, project_id, code, title, value_paise, status, created_by)
     values ($1, $2, 'WT-DRAFT-1', 'Coimbatore Works-Tender Draft Contract', 300000000000, 'DRAFT', $3)
     on conflict (code) do nothing`,
    [draftContractId, D.COIMBATORE.project, D.COIMBATORE.officer]);
  summary.push({ district: 'COIMBATORE', contract: 'WT-DRAFT-1', boqItems: 0,
    deliveries: 0, approved: 0, pendingApproval: 0 });

  // A fresh applicant: CONTRACTOR role at Coimbatore, no contractor row yet, so
  // the registration wizard is demoable end to end.
  const APPLICANT = 'c0a00000-0000-0000-0000-000000000003';
  await client.query(
    `insert into eworks.user_profiles (id, phone, full_name) values ($1,'9500000013','New Contractor Applicant')
     on conflict (id) do nothing`, [APPLICANT]);
  await client.query(
    `insert into eworks.user_roles (user_id, role_code, org_unit_id) values ($1,'CONTRACTOR',$2)
     on conflict on constraint user_roles_unique do nothing`, [APPLICANT, D.COIMBATORE.district]);

  return summary;
}

async function clearDemo(client, { contracts, contractors, contractorUsers }) {
  // Child-before-parent, scoped to the demo contracts/contractors only.
  await client.query(
    `delete from eworks.contractor_payments where delivery_id in
       (select id from eworks.material_deliveries where contract_id = any($1))`, [contracts]);
  await client.query(
    `delete from eworks.order_items where order_id in
       (select test_order_id from eworks.material_deliveries where contract_id = any($1) and test_order_id is not null)`, [contracts]);
  await client.query(
    `delete from eworks.test_orders where id in
       (select test_order_id from eworks.material_deliveries where contract_id = any($1) and test_order_id is not null)`, [contracts]);
  await client.query(`delete from eworks.material_deliveries where contract_id = any($1)`, [contracts]);
  await client.query(`delete from eworks.boq_items where contract_id = any($1)`, [contracts]);
  await client.query(`delete from eworks.contract_bids where contract_id = any($1)`, [contracts]);
  await client.query(`delete from eworks.contracts where id = any($1)`, [contracts]);
  await client.query(`delete from eworks.contractor_documents where contractor_id = any($1)`, [contractors]);
  await client.query(`delete from eworks.contractors where id = any($1)`, [contractors]);
  await client.query(`delete from eworks.user_roles where user_id = any($1) and role_code in ('CONTRACTOR','SITE_ENGINEER')`, [contractorUsers]);
  // keep user_profiles (harmless, and the Salem recorder may be reused)
}

// Standalone runner.
async function main() {
  assertLocalDb();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const summary = await seedContracts(client);
    await client.query('commit');
    console.log('Contracts/materials demo seeded:');
    console.table(summary);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('seed-contracts failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
