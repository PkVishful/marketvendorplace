-- Phase 5b verification: pass/fail engine, escalation, certificates, payment.
--
-- QR codes here must satisfy '^EW-[2-9A-HJ-NP-Z]{12}$' -- exactly 12 body
-- characters, no I, O, 0 or 1.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.check(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'pass: %', label;
end;
$$;

create or replace function pg_temp.check_raises(label text, stmt text)
returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    raise notice 'pass: % (rejected: %)', label, left(sqlerrm, 55); return;
  end;
  raise exception 'FAIL: % -- accepted but should have been rejected', label;
end;
$$;

-- Builds an awarded job with one specimen already received at the lab, and a
-- HELD payment. Leaves app.user_id set to the technician.
create or replace function pg_temp.ready_specimen(
  p_id uuid, p_qr text, p_age int)
returns void language plpgsql as $$
begin
  insert into eworks.test_orders
    (id, project_id, org_unit_id, milestone, stage_id, site, status,
     floated_at, bid_close_at, reveal_close_at, required_by, created_by)
  select p_id, '11111111-0000-0000-0000-000000000008',
         '11111111-0000-0000-0000-000000000006', 'Pour R', cs.id,
         st_makepoint(76.9558, 11.0168)::geography, 'FLOATED',
         now() - interval '1 hour', now() + interval '1 minute',
         now() + interval '2 hours', current_date + 30,
         '22222222-0000-0000-0000-00000000000d'
    from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE';
  insert into eworks.order_items (order_id, test_id, quantity)
  select p_id, id, 6 from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

  perform set_config('app.user_id','44444444-0000-0000-0000-00000000000a', true);
  perform eworks.submit_bid_commitment(p_id,
    eworks.bid_commitment(p_id,'55555555-0000-0000-0000-00000000000a',250000,'n'));
  update eworks.test_orders set bid_close_at = now()-interval '1 minute',
         reveal_close_at = now()+interval '1 hour' where id=p_id;
  perform eworks.close_bidding(p_id);
  perform eworks.reveal_bid(p_id, 250000, 'n');
  update eworks.test_orders set reveal_close_at = now()-interval '1 second' where id=p_id;
  perform eworks.finalize_award(p_id);
  perform eworks.hold_payment(p_id);

  insert into eworks.test_jobs (id, order_id, vendor_id, technician_id)
  values (p_id, p_id, '55555555-0000-0000-0000-00000000000a',
          '44444444-0000-0000-0000-00000000000f');

  perform set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
  perform eworks.check_in(p_id, 11.01760, 76.9558, 10, 'device-1',
    digest(convert_to(p_id::text,'UTF8'),'sha256'), now());

  insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
  select p_id, id, p_qr, 1, p_age from eworks.test_catalog
   where code='CONCRETE_CUBE_STRENGTH';

  perform eworks.record_custody(p_qr,'MOLDED');
  perform eworks.record_custody(p_qr,'SEALED');
  perform eworks.record_custody(p_qr,'PICKED_UP');
  perform eworks.record_custody(p_qr,'RECEIVED_AT_LAB');
end;
$$;

-- The project is M25: characteristic cube strength 25 N/mm2.
begin;
insert into eworks.project_parameters (project_id, key, value) values
  ('11111111-0000-0000-0000-000000000008',
   'project.concrete_grade_characteristic_strength', 25)
on conflict do nothing;
commit;


-- ===========================================================================
-- 1. The engine: data-driven, threshold resolved from the project.
-- ===========================================================================
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000001','EW-PASSPASS2345', 28);

select pg_temp.check('30 N/mm2 against an M25 project passes',
  (eworks.record_test_result('EW-PASSPASS2345',
     '{"load_kn":675,"area_mm2":22500,"strength_n_per_mm2":30}'::jsonb)).passed = true);

select pg_temp.check('The RESOLVED threshold is stored, not the parameter name',
  (select threshold_min from eworks.test_results
    where sample_id = (select id from eworks.samples where qr_code='EW-PASSPASS2345')) = 25);

select pg_temp.check('The criteria are snapshotted onto the result',
  (select applied_criteria ->> 'metric' from eworks.test_results
    where sample_id = (select id from eworks.samples where qr_code='EW-PASSPASS2345'))
   = 'strength_n_per_mm2');

select pg_temp.check('The raw readings are kept so an auditor can recompute',
  (select measurements ->> 'load_kn' from eworks.test_results
    where sample_id = (select id from eworks.samples where qr_code='EW-PASSPASS2345')) = '675');

select pg_temp.check('A passing 28-day result raises NO escalation',
  (select count(*) from eworks.escalations) = 0);

select pg_temp.check('Recording a result appends a TESTED custody event',
  (select count(*) from eworks.chain_of_custody c
     join eworks.samples s on s.id = c.sample_id
    where s.qr_code='EW-PASSPASS2345' and c.event='TESTED') = 1);
rollback;


-- The threshold comes from the project. Change the project's grade and the same
-- measurement flips verdict -- with no code touched. This is what s0's
-- "no hardcoded business logic" has to mean in practice.
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000002','EW-GRADEM452345', 28);
update eworks.project_parameters set value = 45
 where project_id='11111111-0000-0000-0000-000000000008';

select pg_temp.check('The same 30 N/mm2 FAILS on an M45 project',
  (eworks.record_test_result('EW-GRADEM452345',
     '{"strength_n_per_mm2":30}'::jsonb)).passed = false);
rollback;


-- A missing design parameter must refuse. Silently treating it as "unbounded"
-- would make every result pass.
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000003','EW-NPARAM234567', 28);
delete from eworks.project_parameters
 where project_id='11111111-0000-0000-0000-000000000008';

select pg_temp.check_raises('A missing design parameter refuses the evaluation',
  $$select eworks.record_test_result('EW-NPARAM234567',
      '{"strength_n_per_mm2":30}'::jsonb)$$);
rollback;


begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000004','EW-NMETRC234567', 28);
select pg_temp.check_raises('A result missing the required metric is refused',
  $$select eworks.record_test_result('EW-NMETRC234567',
      '{"load_kn":675}'::jsonb)$$);
rollback;


-- ===========================================================================
-- 2. Custody is a precondition for a result.
-- ===========================================================================
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000005','EW-CUSTDY234567', 28);

-- Never received at the lab. Removing the event needs the append-only trigger
-- disabled, which is itself the point: only a DBA could stage this.
alter table eworks.chain_of_custody disable trigger custody_no_change_trg;
delete from eworks.chain_of_custody
 where sample_id = (select id from eworks.samples where qr_code='EW-CUSTDY234567')
   and event = 'RECEIVED_AT_LAB';
alter table eworks.chain_of_custody enable trigger custody_no_change_trg;

select pg_temp.check_raises('A specimen never received at the lab cannot have a result',
  $$select eworks.record_test_result('EW-CUSTDY234567',
      '{"strength_n_per_mm2":30}'::jsonb)$$);
rollback;


begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000006','EW-BRKENCHAN234', 28);

-- Rewrite where the cube was molded -- the edit someone covering up an
-- off-site pour would actually make. (Rewriting `event` instead would trip the
-- unique(sample_id, event) constraint before the hash chain ever noticed.)
alter table eworks.chain_of_custody disable trigger custody_no_change_trg;
update eworks.chain_of_custody
   set gps = st_makepoint(78.1460, 11.6643)::geography     -- 135 km away, in Salem
 where sample_id = (select id from eworks.samples where qr_code='EW-BRKENCHAN234')
   and event = 'MOLDED';
alter table eworks.chain_of_custody enable trigger custody_no_change_trg;

select pg_temp.check_raises('A broken chain of custody refuses the result',
  $$select eworks.record_test_result('EW-BRKENCHAN234',
      '{"strength_n_per_mm2":30}'::jsonb)$$);
rollback;


-- ===========================================================================
-- 3. Failure escalates; it does not block. The 7-day break is provisional.
-- ===========================================================================
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000007','EW-SEVENDAY2345', 7);

select pg_temp.check('A 7-day result is marked provisional',
  (eworks.record_test_result('EW-SEVENDAY2345',
     '{"strength_n_per_mm2":12}'::jsonb)).is_provisional = true);

select pg_temp.check('The 7-day break FAILED against the 28-day criterion',
  (select passed from eworks.test_results
    where sample_id=(select id from eworks.samples where qr_code='EW-SEVENDAY2345')) = false);

-- s7: "construction proceeds provisionally on the 7-day result."
select pg_temp.check('A provisional failure raises NO escalation',
  (select count(*) from eworks.escalations) = 0);
rollback;


begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000008','EW-FAULT28DAY23', 28);

select pg_temp.check('A 28-day result is not provisional',
  (eworks.record_test_result('EW-FAULT28DAY23',
     '{"strength_n_per_mm2":18}'::jsonb)).is_provisional = false);

select pg_temp.check('A confirmed failure raises exactly one escalation',
  (select count(*) from eworks.escalations
    where order_id='99999999-0000-0000-0000-000000000008') = 1);

select pg_temp.check('The escalation demands a core test and is OPEN',
  (select level = 'CORE_TEST' and status = 'OPEN' from eworks.escalations
    where order_id='99999999-0000-0000-0000-000000000008'));

select pg_temp.check('The escalation reason records the shortfall',
  (select reason like '%strength_n_per_mm2 = 18%' from eworks.escalations
    where order_id='99999999-0000-0000-0000-000000000008'));

select pg_temp.check('The failure was written to the audit log',
  (select count(*) from eworks.audit_logs where action='result.escalated') = 1);

-- s7 again: "not a naive block". The result stands; nothing is rolled back.
select pg_temp.check('The failing result is recorded, not discarded',
  (select count(*) from eworks.test_results
    where job_id='99999999-0000-0000-0000-000000000008') = 1);

-- A second reading for the same cube is a retest. A retest that silently
-- overwrites is how a failure disappears.
select pg_temp.check_raises('A specimen cannot be re-tested over its own result',
  $$select eworks.record_test_result('EW-FAULT28DAY23',
      '{"strength_n_per_mm2":40}'::jsonb)$$);
rollback;


-- ===========================================================================
-- 4. Payment: held until a VERIFIED certificate, never gated on a pass.
-- ===========================================================================
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-000000000009','EW-PAYMENT23456', 28);

select pg_temp.check('An award creates a HELD payment at the awarded price',
  (select status='HELD' and amount_paise=250000 from eworks.payments
    where order_id='99999999-0000-0000-0000-000000000009'));

-- The lab currently holds the session. It must not be able to pay itself.
select pg_temp.check_raises('A lab cannot release its own payment',
  $$select eworks.release_payment('99999999-0000-0000-0000-000000000009','key-x')$$);

-- An officer with order.award drives the release from here on.
select set_config('app.user_id','22222222-0000-0000-0000-00000000000b', true);

select pg_temp.check_raises('No certificate: payment stays held',
  $$select eworks.release_payment('99999999-0000-0000-0000-000000000009','key-1')$$);

insert into eworks.certificates (job_id, storage_path, sha256, uploaded_by)
values ('99999999-0000-0000-0000-000000000009','certs/a.pdf',
        decode(repeat('d1',32),'hex'), '44444444-0000-0000-0000-00000000000a');

select pg_temp.check_raises('Unverified signature: payment stays held',
  $$select eworks.release_payment('99999999-0000-0000-0000-000000000009','key-1')$$);

update eworks.certificates
   set signature_verified = true, signer_name = 'eMudhra test', verified_at = now()
 where job_id = '99999999-0000-0000-0000-000000000009';

select pg_temp.check_raises('Verified certificate but no result: payment stays held',
  $$select eworks.release_payment('99999999-0000-0000-0000-000000000009','key-1')$$);

-- Deliberately a FAILING result. The lab performed the test; paying only on a
-- pass would pay labs to report passes.
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);  -- technician
select eworks.record_test_result('EW-PAYMENT23456','{"strength_n_per_mm2":10}'::jsonb);
select set_config('app.user_id','22222222-0000-0000-0000-00000000000b', true);  -- officer

select pg_temp.check('Payment releases on a FAILING result, once certified',
  (eworks.release_payment('99999999-0000-0000-0000-000000000009','key-1',
     'PFMS/2026/001','GST-INV-9')).status = 'RELEASED');

select pg_temp.check('...and the failure still escalated',
  (select count(*) from eworks.escalations
    where order_id='99999999-0000-0000-0000-000000000009') = 1);

-- s12: idempotent payment operations. A retried release must not disburse twice.
select pg_temp.check('Replaying the same idempotency key returns the same payment',
  (eworks.release_payment('99999999-0000-0000-0000-000000000009','key-1')).released_at
   = (select released_at from eworks.payments
       where order_id='99999999-0000-0000-0000-000000000009'));

select pg_temp.check_raises('A DIFFERENT key against a released payment is refused',
  $$select eworks.release_payment('99999999-0000-0000-0000-000000000009','key-2')$$);

select pg_temp.check('Exactly one payment row exists for the order',
  (select count(*) from eworks.payments
    where order_id='99999999-0000-0000-0000-000000000009') = 1);

select pg_temp.check('The treasury reference and GST invoice were recorded',
  (select treasury_ref='PFMS/2026/001' and gst_invoice_no='GST-INV-9'
     from eworks.payments where order_id='99999999-0000-0000-0000-000000000009'));

select pg_temp.check('The release was audited',
  (select count(*) from eworks.audit_logs where action='payment.release') = 1);

select pg_temp.check('The audit chain still verifies after the whole flow',
  eworks.verify_audit_chain() is null);
rollback;


-- A lab must not be able to declare its own certificate signature-verified.
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-00000000000a','EW-SELFVERFY234', 28);

set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000a', true); -- Vendor A owner

select pg_temp.check_raises('A lab cannot upload a self-verified certificate',
  $$insert into eworks.certificates (job_id, storage_path, sha256, uploaded_by,
      signature_verified, signer_name, verified_at)
    values ('99999999-0000-0000-0000-00000000000a','certs/self.pdf',
      decode(repeat('e1',32),'hex'),'44444444-0000-0000-0000-00000000000a',
      true,'self',now())$$);

insert into eworks.certificates (job_id, storage_path, sha256, uploaded_by)
values ('99999999-0000-0000-0000-00000000000a','certs/ok.pdf',
        decode(repeat('e2',32),'hex'),'44444444-0000-0000-0000-00000000000a');
select pg_temp.check('A lab CAN upload an unverified certificate',
  (select signature_verified = false from eworks.certificates
    where job_id='99999999-0000-0000-0000-00000000000a'));

select set_config('app.user_id','44444444-0000-0000-0000-00000000000c', true); -- rival lab
select pg_temp.check('A rival lab sees NO certificate',
  (select count(*) from eworks.certificates) = 0);
select pg_temp.check('A rival lab sees NO payment',
  (select count(*) from eworks.payments) = 0);
select pg_temp.check('A rival lab sees NO result',
  (select count(*) from eworks.test_results) = 0);
rollback;


-- ===========================================================================
-- 5. Escalation resolution requires result.verify.
-- ===========================================================================
begin;
select pg_temp.ready_specimen('99999999-0000-0000-0000-00000000000b','EW-ESCALATE2345', 28);
select eworks.record_test_result('EW-ESCALATE2345','{"strength_n_per_mm2":9}'::jsonb);

set local role eworks_authenticated;

select set_config('app.user_id','44444444-0000-0000-0000-00000000000a', true); -- the lab
select pg_temp.check('The lab SEES the escalation against its own result',
  (select count(*) from eworks.escalations
    where order_id='99999999-0000-0000-0000-00000000000b') = 1);

-- RLS hides the row from the UPDATE rather than raising. Zero rows affected.
update eworks.escalations
   set status='RESOLVED', resolved_by='22222222-0000-0000-0000-00000000000d',
       resolved_at=now(), resolution='ignore it'
 where order_id='99999999-0000-0000-0000-00000000000b';
select pg_temp.check('The lab CANNOT resolve its own escalation (0 rows affected)',
  (select status from eworks.escalations
    where order_id='99999999-0000-0000-0000-00000000000b') = 'OPEN');

select set_config('app.user_id','22222222-0000-0000-0000-00000000000d', true); -- site engineer
update eworks.escalations
   set status='RESOLVED', resolved_by='22222222-0000-0000-0000-00000000000d',
       resolved_at=now(), resolution='Cores extracted; strength adequate. Accepted.'
 where order_id='99999999-0000-0000-0000-00000000000b';

select pg_temp.check('The site engineer CAN resolve the escalation',
  (select status from eworks.escalations
    where order_id='99999999-0000-0000-0000-00000000000b') = 'RESOLVED');

set local role postgres;
select pg_temp.check_raises('A resolution with no attributed engineer is rejected',
  $$update eworks.escalations set status='REJECTED', resolved_by=null,
       resolved_at=null, resolution=null
     where order_id='99999999-0000-0000-0000-00000000000b'$$);
rollback;

\echo ''
\echo ' PHASE 5b CHECKS COMPLETE'
