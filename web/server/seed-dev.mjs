// Dev-only seed for the notification feed.
//
// The SQL test suite creates notifications inside `begin; ... rollback;`, so a
// freshly built `eworks` database has zero committed notifications. This script
// commits a small, realistic scenario against the LOCAL database only, so the
// feed has something to show and two-vendor RLS scoping can be demonstrated.
//
// It touches only notification tables + a couple of demo orders. It does NOT
// change any schema. Run:  node server/seed-dev.mjs
//
// Scenario it builds:
//   * Vendor A (Coimbatore Concrete Labs) and Vendor C (Salem) are each told
//     their lab was APPROVED  -> proves per-recipient scoping.
//   * One order is floated; both A and C are eligible and notified.
//   * Vendor A's NABL is then lapsed, so that order becomes a DEAD LINK for A
//     (still holds the notice, reads zero rows from test_orders) while it stays
//     a live link for C.  -> proves the dead-link property end to end.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.mjs';
import { saveKycDocument } from './kyc-upload.mjs';
import { seedDistricts, assertLocalDb } from './seed-districts.mjs';
import { seedContracts } from './seed-contracts.mjs';

const serverDir = dirname(fileURLToPath(import.meta.url));

async function runSqlFile(client, filename) {
  const sql = readFileSync(join(serverDir, filename), 'utf8');
  await client.query(sql);
}

async function ensureDevIdentity(client) {
  await runSqlFile(client, 'seed-dev-identity.sql');
  await runSqlFile(client, 'seed-vendor-fixtures.sql');
}

const VENDOR_A = '55555555-0000-0000-0000-00000000000a';
const VENDOR_C = '55555555-0000-0000-0000-00000000000c';
const ORDER_FLOAT = 'aaaa1111-0000-0000-0000-000000000001';
const ORDER_JOB = 'bbbb2222-0000-0000-0000-000000000002';
const CERT_DEMO = 'cccc3333-0000-0000-0000-000000000001';
const TECH = '44444444-0000-0000-0000-00000000000f';
const VENDOR_OWNER = '44444444-0000-0000-0000-00000000000a';
const APPLICANT_USER = '44444444-0000-0000-0000-000000000010';
const VENDOR_E = '55555555-0000-0000-0000-00000000000e';
const COIM_ORG = '11111111-0000-0000-0000-000000000002';
const ORG_PATH = 'TN.COIMBATORE';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seedKycDemo(client) {
  await client.query(
    `insert into eworks.user_profiles (id, phone, full_name)
     values ($1, '9100000010', 'New Lab Applicant')
     on conflict (id) do nothing`,
    [APPLICANT_USER],
  );
  await client.query(
    `insert into eworks.user_roles (user_id, role_code, org_unit_id)
     values ($1, 'LAB_VENDOR', $2)
     on conflict do nothing`,
    [APPLICANT_USER, COIM_ORG],
  );

  await client.query(`update eworks.vendors set status = 'SUBMITTED' where id = $1`, [VENDOR_E]);

  const requiredDocs = [
    'GST_CERTIFICATE',
    'PAN_COMPANY',
    'NABL_CERTIFICATE',
    'ADDRESS_PROOF',
    'ID_PROOF',
  ];
  for (const docType of requiredDocs) {
    const saved = await saveKycDocument(VENDOR_E, docType, TINY_PNG, 'image/png');
    await client.query(
      `delete from eworks.vendor_documents where vendor_id = $1 and doc_type = $2::eworks.vendor_doc_type`,
      [VENDOR_E, docType],
    );
    await client.query(
      `insert into eworks.vendor_documents
         (vendor_id, doc_type, storage_path, mime_type, sha256, scanned_clean, status)
       values ($1, $2::eworks.vendor_doc_type, $3, $4, $5, true, 'PENDING')`,
      [VENDOR_E, docType, saved.storagePath, saved.mimeType, saved.sha256],
    );
  }
}

async function seedFieldJob(client) {
  await client.query(
    `delete from eworks.escalations where order_id = $1`,
    [ORDER_JOB],
  );
  await client.query(
    `delete from eworks.test_results tr
      using eworks.samples s where tr.sample_id = s.id and s.job_id = $1`,
    [ORDER_JOB],
  );
  await client.query('delete from eworks.payments where order_id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.certificates where job_id = $1', [ORDER_JOB]);
  await client.query(
    `delete from eworks.chain_of_custody c
      using eworks.samples s where c.sample_id = s.id and s.job_id = $1`,
    [ORDER_JOB],
  );
  await client.query('delete from eworks.samples where job_id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.site_checkins where job_id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.test_jobs where id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.order_award where order_id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.order_bids where order_id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.order_items where order_id = $1', [ORDER_JOB]);
  await client.query('delete from eworks.test_orders where id = $1', [ORDER_JOB]);

  await client.query(
    `insert into eworks.user_profiles (id, phone, full_name)
     values ($1, '9100000009', 'Vendor A Technician')
     on conflict (id) do nothing`,
    [TECH],
  );
  await client.query(
    `insert into eworks.user_roles (user_id, role_code, org_unit_id)
     values ($1, 'FIELD_TECHNICIAN', '11111111-0000-0000-0000-000000000002')
     on conflict do nothing`,
    [TECH],
  );

  await client.query(
    `insert into eworks.project_parameters (project_id, key, value) values
       ('11111111-0000-0000-0000-000000000008',
        'project.concrete_grade_characteristic_strength', 25)
     on conflict do nothing`,
  );

  await client.query(
    `insert into eworks.test_orders
       (id, project_id, org_unit_id, milestone, stage_id, site, status,
        floated_at, bid_close_at, reveal_close_at, required_by, created_by)
     select $1, '11111111-0000-0000-0000-000000000008',
            '11111111-0000-0000-0000-000000000006', 'Field demo — column pour',
            cs.id, st_makepoint(76.9558, 11.0168)::geography, 'FLOATED',
            now() - interval '1 hour', now() + interval '1 minute',
            now() + interval '2 hours', current_date + 30,
            '22222222-0000-0000-0000-00000000000d'
       from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE'`,
    [ORDER_JOB],
  );
  await client.query(
    `insert into eworks.order_items (order_id, test_id, quantity, test_ages_days)
     select $1, id, 6, '{7,28}' from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH'`,
    [ORDER_JOB],
  );

  await client.query(`select set_config('app.user_id', $1, true)`, [VENDOR_OWNER]);
  await client.query(
    `select eworks.submit_bid_commitment($1, eworks.bid_commitment($1, $2, 250000, 'n'))`,
    [ORDER_JOB, VENDOR_A],
  );
  await client.query(
    `update eworks.test_orders
        set bid_close_at = now() - interval '1 minute',
            reveal_close_at = now() + interval '1 hour'
      where id = $1`,
    [ORDER_JOB],
  );
  await client.query(`select eworks.close_bidding($1)`, [ORDER_JOB]);
  await client.query(`select eworks.reveal_bid($1, 250000, 'n')`, [ORDER_JOB]);
  await client.query(
    `update eworks.test_orders set reveal_close_at = now() - interval '1 second' where id = $1`,
    [ORDER_JOB],
  );
  await client.query(`select eworks.finalize_award($1)`, [ORDER_JOB]);
  await client.query(`select eworks.hold_payment($1)`, [ORDER_JOB]);
  await client.query(
    `insert into eworks.test_jobs (id, order_id, vendor_id, technician_id)
     values ($1, $1, $2, $3)`,
    [ORDER_JOB, VENDOR_A, TECH],
  );

  await client.query(
    `insert into eworks.certificates
       (id, job_id, storage_path, sha256, uploaded_by, signature_verified, signer_name, verified_at)
     values ($1, $2, 'dev/certs/field-demo.pdf', decode(repeat('ab',32),'hex'), $3,
             true, 'eMudhra test (dev)', now())
     on conflict (id) do update
       set signature_verified = true,
           signer_name = excluded.signer_name,
           verified_at = excluded.verified_at`,
    [CERT_DEMO, ORDER_JOB, VENDOR_OWNER],
  );
}

async function main() {
  // The remote Supabase is shared with a separate app; never seed against it.
  assertLocalDb();
  const client = await pool.connect();
  try {
    await client.query('begin');

    await ensureDevIdentity(client);

    // All 38 TN districts with varied health, so the statewide map isn't just
    // Coimbatore + Salem. Runs after the TN state node exists.
    const districtSummary = await seedDistricts(client);

    // Contractor / material-inspection demo (contracts, BOQ, deliveries) on the
    // two deep districts, so the material flow has data end to end.
    await seedContracts(client);

    // Idempotent: clear prior notification data (dev DB only) and demo order.
    await client.query('delete from eworks.notification_events');
    await client.query('delete from eworks.test_orders where id = $1', [ORDER_FLOAT]);

    // Restore Vendor A's accreditation so it is eligible at float time.
    await client.query(
      "update eworks.vendors set nabl_valid_until = current_date + 365 where id = $1",
      [VENDOR_A],
    );

    // 1) A floated order both A and C are eligible for.
    await client.query(
      `insert into eworks.test_orders
         (id, project_id, org_unit_id, milestone, stage_id, site, status,
          required_by, created_by)
       select $1, '11111111-0000-0000-0000-000000000008',
              '11111111-0000-0000-0000-000000000006', 'Superstructure - column pour',
              cs.id, st_makepoint(76.9558, 11.0168)::geography, 'DRAFT',
              current_date + 30, '22222222-0000-0000-0000-00000000000d'
         from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE'`,
      [ORDER_FLOAT],
    );
    await client.query(
      `insert into eworks.order_items (order_id, test_id, quantity)
       select $1, id, 6 from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH'`,
      [ORDER_FLOAT],
    );
    // Float it -> fires ORDER_FLOATED to eligible vendors (A and C).
    await client.query(
      `update eworks.test_orders
          set status = 'FLOATED',
              floated_at = least(now(), now() + interval '2 hours' - interval '1 minute'),
              bid_close_at = now() + interval '2 hours',
              reveal_close_at = now() + interval '3 hours'
        where id = $1`,
      [ORDER_FLOAT],
    );

    // 2) Each vendor is told its lab was approved (vendor-subject events).
    await client.query(
      "select eworks.emit_notification('VENDOR_APPROVED', null, $1, $2::ltree, array[owner_user_id]) from eworks.vendors where id = $1",
      [VENDOR_A, ORG_PATH],
    );
    await client.query(
      "select eworks.emit_notification('VENDOR_APPROVED', null, $1, $2::ltree, array[owner_user_id]) from eworks.vendors where id = $1",
      [VENDOR_C, ORG_PATH],
    );

    // Field job demo (needs Vendor A eligible at bid time).
    await seedFieldJob(client);

    await seedKycDemo(client);

    // 3) Lapse Vendor A's NABL: the floated order is now a dead link FOR A only.
    await client.query(
      "update eworks.vendors set nabl_valid_until = current_date - 1 where id = $1",
      [VENDOR_A],
    );

    await client.query('commit');

    const { rows } = await pool.query(
      `select p.id as owner, count(*) as notifications
         from eworks.notifications n
         join eworks.notification_events e on e.id = n.event_id
         join eworks.user_profiles p on p.id = n.recipient_user_id
        group by p.id order by p.id`,
    );
    const spread = districtSummary.reduce((acc, r) => {
      acc[r.profile] = (acc[r.profile] || 0) + 1;
      return acc;
    }, {});
    console.log(`Seed complete. ${districtSummary.length} generated districts (+ Coimbatore, Salem = ${districtSummary.length + 2} total).`);
    console.log('District health spread:', spread);
    console.log('Notifications per recipient:');
    for (const r of rows) console.log('  ' + r.owner + '  ->  ' + r.notifications);
  } catch (err) {
    await pool.query('rollback').catch(() => {});
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
