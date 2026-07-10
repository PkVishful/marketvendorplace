-- Phase 5b: results, pass/fail, escalation, certificates, payment
-- (master prompt s7 step 5, s9, s12, s13, s14).
--
-- Two decisions here deserve to be argued rather than assumed.
--
-- 1. PAYMENT IS FOR THE TEST, NOT FOR A PASS.
--    s12 says payment is "held until a valid certificate exists". It does NOT
--    say "held until the concrete passes", and it must not. A lab that is paid
--    only when the cube passes has a direct financial incentive to report a
--    pass. Release is therefore gated on a verified certificate and complete
--    results -- never on `passed = true`.
--
-- 2. A FAILURE ESCALATES; IT DOES NOT BLOCK.
--    s7: "FAIL -> escalation (core/NDT/structural sign-off), not a naive block
--    -- construction proceeds provisionally on the 7-day result." A 7-day
--    result is an early indicator, not an acceptance criterion. Only the
--    28-day result decides the milestone.

-- Per-project design values that acceptance criteria refer to by name. This is
-- what makes `{"min_from": "project.concrete_grade_characteristic_strength"}`
-- resolvable without hardcoding M25 into the catalog (s0).
create table eworks.project_parameters (
  project_id uuid not null references eworks.org_units(id) on delete cascade,
  key        text not null check (key ~ '^[a-z_]+\.[a-z_]+$'),
  value      numeric not null,
  primary key (project_id, key)
);


create type eworks.escalation_level as enum (
  'CORE_TEST',        -- extract cores from the structure
  'NDT',              -- UPV / rebound hammer
  'STRUCTURAL_REVIEW' -- designer signs off, or the element comes down
);

create type eworks.escalation_status as enum ('OPEN', 'RESOLVED', 'REJECTED');

create table eworks.test_results (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references eworks.test_jobs(id) on delete restrict,
  sample_id     uuid not null references eworks.samples(id) on delete restrict,
  test_id       uuid not null references eworks.test_catalog(id) on delete restrict,

  age_days      int,

  -- Raw readings as the lab entered them, e.g. {"load_kn": 720, "area_mm2": 22500}
  -- plus the derived metric. Kept whole so an auditor can recompute.
  measurements  jsonb not null,

  -- The criterion actually applied, snapshotted. A QAP revised later must not
  -- change whether this cube passed.
  applied_criteria jsonb not null,
  metric        text not null,
  metric_value  numeric not null,
  threshold_min numeric,
  threshold_max numeric,
  passed        boolean not null,

  -- s7: construction proceeds provisionally on the 7-day result.
  is_provisional boolean not null,

  entered_by    uuid not null references eworks.user_profiles(id),
  entered_at    timestamptz not null default now(),

  -- One result per specimen. A second reading for the same cube is a retest,
  -- and a retest that silently overwrites is how a failure disappears.
  constraint test_results_one_per_sample unique (sample_id)
);

create index test_results_job_idx on eworks.test_results (job_id);


create table eworks.escalations (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references eworks.test_orders(id) on delete restrict,
  result_id   uuid not null references eworks.test_results(id) on delete restrict,
  level       eworks.escalation_level not null,
  reason      text not null,
  status      eworks.escalation_status not null default 'OPEN',

  raised_at   timestamptz not null default now(),
  resolved_by uuid references eworks.user_profiles(id),
  resolved_at timestamptz,
  resolution  text,

  constraint escalations_one_per_result unique (result_id),
  constraint escalations_resolution_attributed check (
    status = 'OPEN' or (resolved_by is not null and resolved_at is not null
                        and resolution is not null)
  )
);

create index escalations_open_idx on eworks.escalations (order_id) where status = 'OPEN';


create table eworks.certificates (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references eworks.test_jobs(id) on delete restrict,

  storage_path  text not null,
  -- s9: store the hash, verify the signature, expose a public QR check. The
  -- hash proves the served bytes are the reviewed bytes.
  sha256        bytea not null unique check (length(sha256) = 32),

  -- Set by the signature verifier, NOT by the uploading lab. We cannot issue
  -- signatures without a DSC from a licensed CA (see docs/security-gaps.md #7),
  -- so this stays false until a verifier confirms one.
  signature_verified boolean not null default false,
  signer_name   text,
  verified_at   timestamptz,

  issued_at     timestamptz not null default now(),
  uploaded_by   uuid not null references eworks.user_profiles(id),

  constraint certificates_one_per_job unique (job_id),
  constraint certificates_verification_attributed check (
    not signature_verified or (signer_name is not null and verified_at is not null)
  )
);


create type eworks.payment_status as enum ('HELD', 'RELEASED', 'CANCELLED');

create table eworks.payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references eworks.test_orders(id) on delete restrict,
  vendor_id      uuid not null references eworks.vendors(id) on delete restrict,
  amount_paise   bigint not null check (amount_paise > 0),

  status         eworks.payment_status not null default 'HELD',

  -- s12: idempotent payment operations. A retried release must not disburse
  -- twice. The unique key is the guarantee; the application does not get a vote.
  idempotency_key text not null unique,

  treasury_ref   text,          -- PFMS reference, once the department integrates
  gst_invoice_no text,
  released_at    timestamptz,
  created_at     timestamptz not null default now(),

  constraint payments_one_per_order unique (order_id),
  constraint payments_released_has_ref check (
    status <> 'RELEASED' or released_at is not null
  )
);


-- ---------------------------------------------------------------------------
-- The pass/fail engine
-- ---------------------------------------------------------------------------

-- Resolves a threshold that is either a literal (`min`) or a named project
-- parameter (`min_from`). Returns NULL when the criterion does not bound that
-- side -- a slump has both a min and a max; a cube strength has only a min.
create or replace function eworks.resolve_threshold(
  p_project_id uuid,
  p_criteria   jsonb,
  p_bound      text          -- 'min' or 'max'
)
returns numeric
language plpgsql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_key text;
  v_val numeric;
begin
  if p_criteria ? p_bound then
    return (p_criteria ->> p_bound)::numeric;
  end if;

  v_key := p_criteria ->> (p_bound || '_from');
  if v_key is null then
    return null;
  end if;

  select value into v_val from eworks.project_parameters
   where project_id = p_project_id and key = v_key;

  if v_val is null then
    -- Refusing is correct. A missing design value must not silently become an
    -- unbounded criterion that every result passes.
    raise exception 'project % has no parameter % required by the acceptance criteria',
      p_project_id, v_key;
  end if;
  return v_val;
end;
$$;


-- Records a lab result against a specimen, evaluates it, and escalates on a
-- confirmed failure. The engine contains no test-specific branches: it reads
-- `metric`, `min`/`max` from the criteria and compares. Adding a test type
-- needs catalog rows, not code.
create or replace function eworks.record_test_result(
  p_qr_code      text,
  p_measurements jsonb
)
returns eworks.test_results
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_sample   eworks.samples;
  v_job      eworks.test_jobs;
  v_order    eworks.test_orders;
  v_criteria jsonb;
  v_metric   text;
  v_value    numeric;
  v_min      numeric;
  v_max      numeric;
  v_passed   boolean;
  v_prov     boolean;
  v_result   eworks.test_results;
  v_path     ltree;
begin
  select * into v_sample from eworks.samples where qr_code = p_qr_code;
  if v_sample.id is null then
    raise exception 'unknown QR code %', p_qr_code;
  end if;

  select * into v_job   from eworks.test_jobs   where id = v_sample.job_id;
  select * into v_order from eworks.test_orders where id = v_job.order_id;

  if not eworks.has_permission_anywhere('result.enter') then
    raise exception 'permission denied: result.enter' using errcode = 'insufficient_privilege';
  end if;

  -- The specimen must have reached the lab. A result for a cube that was never
  -- received is a result for a cube that does not exist.
  if not exists (select 1 from eworks.chain_of_custody
                  where sample_id = v_sample.id and event = 'RECEIVED_AT_LAB') then
    raise exception 'specimen % has no RECEIVED_AT_LAB custody event', p_qr_code
      using errcode = 'check_violation';
  end if;

  if eworks.verify_custody_chain(v_sample.id) is not null then
    raise exception 'chain of custody for specimen % is broken; refusing to record a result',
      p_qr_code using errcode = 'check_violation';
  end if;

  -- Prefer the snapshot taken when the project was planned; fall back to the
  -- governing rule if this order was raised without a planned requirement.
  select ptr.acceptance_criteria into v_criteria
    from eworks.project_test_requirements ptr
   where ptr.project_id = v_order.project_id
     and ptr.test_id = v_sample.test_id
     and ptr.stage_id = v_order.stage_id;

  if v_criteria is null then
    v_criteria := (eworks.resolve_stage_rule(v_order.project_id, v_sample.test_id,
                                             v_order.stage_id)).acceptance_criteria;
  end if;
  if v_criteria is null then
    raise exception 'no acceptance criteria govern test % on this project', v_sample.test_id;
  end if;

  v_metric := v_criteria ->> 'metric';
  if v_metric is null or not (p_measurements ? v_metric) then
    raise exception 'measurements do not contain the required metric %', v_metric;
  end if;
  v_value := (p_measurements ->> v_metric)::numeric;

  v_min := eworks.resolve_threshold(v_order.project_id, v_criteria, 'min');
  v_max := eworks.resolve_threshold(v_order.project_id, v_criteria, 'max');

  if v_min is null and v_max is null then
    raise exception 'acceptance criteria for % bound neither min nor max', v_metric;
  end if;

  v_passed := (v_min is null or v_value >= v_min)
          and (v_max is null or v_value <= v_max);

  -- s7: the 7-day break is an early indicator; construction proceeds on it.
  -- Only the 28-day result is an acceptance decision.
  v_prov := coalesce(v_sample.test_age_days, 28) < 28;

  insert into eworks.test_results
    (job_id, sample_id, test_id, age_days, measurements, applied_criteria,
     metric, metric_value, threshold_min, threshold_max, passed, is_provisional, entered_by)
  values
    (v_job.id, v_sample.id, v_sample.test_id, v_sample.test_age_days,
     p_measurements, v_criteria, v_metric, v_value, v_min, v_max, v_passed,
     v_prov, eworks.current_user_id())
  returning * into v_result;

  perform eworks.record_custody(p_qr_code, 'TESTED');

  select ou.path into v_path from eworks.org_units ou where ou.id = v_order.org_unit_id;
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'result.record', 'test_result', v_result.id, v_path,
          jsonb_build_object('qr_code', p_qr_code, 'metric', v_metric,
                             'value', v_value, 'passed', v_passed,
                             'provisional', v_prov));

  -- A confirmed (non-provisional) failure escalates. It does not block: the
  -- structure already exists, and the decision about it belongs to an engineer.
  if not v_passed and not v_prov then
    insert into eworks.escalations (order_id, result_id, level, reason)
    values (v_order.id, v_result.id, 'CORE_TEST',
            format('%s = %s, required %s %s', v_metric, v_value,
                   case when v_min is not null then '>= '||v_min else '<= '||v_max end,
                   coalesce(v_criteria ->> 'source', '')));

    insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
    values (null, 'result.escalated', 'test_result', v_result.id, v_path,
            jsonb_build_object('metric', v_metric, 'value', v_value));
  end if;

  return v_result;
end;
$$;


-- ---------------------------------------------------------------------------
-- Payment
-- ---------------------------------------------------------------------------

-- Creates the HELD payment when an order is awarded. Money is committed to the
-- vendor at the awarded price and released only later (s12).
create or replace function eworks.hold_payment(p_order_id uuid)
returns eworks.payments
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare v_award eworks.order_award; v_pay eworks.payments;
begin
  select * into v_award from eworks.order_award where order_id = p_order_id;
  if v_award.order_id is null then
    raise exception 'order % has no award', p_order_id;
  end if;

  insert into eworks.payments (order_id, vendor_id, amount_paise, idempotency_key)
  values (p_order_id, v_award.vendor_id, v_award.price_paise,
          'hold:' || p_order_id::text)
  returning * into v_pay;
  return v_pay;
end;
$$;


-- Releases a held payment through treasury/PFMS.
--
-- IDEMPOTENT: calling twice with the same key returns the same row and
-- disburses once. s12 requires this, and a payment API that is retried on
-- timeout will exercise it.
--
-- Gated on a VERIFIED CERTIFICATE, not on a passing result. See the header.
create or replace function eworks.release_payment(
  p_order_id       uuid,
  p_idempotency_key text,
  p_treasury_ref   text default null,
  p_gst_invoice_no text default null
)
returns eworks.payments
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_pay  eworks.payments;
  v_job  eworks.test_jobs;
  v_cert eworks.certificates;
  v_path ltree;
  v_missing int;
begin
  -- Releasing public money is an officer's act. Without this check the function
  -- is SECURITY DEFINER and RLS does not apply, so the winning lab could call
  -- it and disburse its own payment.
  if not eworks.has_permission_anywhere('order.award') then
    raise exception 'permission denied: releasing payment requires order.award'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_pay from eworks.payments where order_id = p_order_id for update;
  if v_pay.id is null then
    raise exception 'no payment held for order %', p_order_id;
  end if;

  -- Idempotent replay: same key, already released -> return the same row.
  if v_pay.status = 'RELEASED' then
    if v_pay.idempotency_key = p_idempotency_key then
      return v_pay;
    end if;
    raise exception 'payment for order % already released under a different key', p_order_id;
  end if;

  select * into v_job from eworks.test_jobs where order_id = p_order_id;
  select * into v_cert from eworks.certificates where job_id = v_job.id;

  if v_cert.id is null then
    raise exception 'no certificate for order %; payment stays held', p_order_id
      using errcode = 'check_violation';
  end if;
  if not v_cert.signature_verified then
    raise exception 'certificate for order % is not signature-verified; payment stays held',
      p_order_id using errcode = 'check_violation';
  end if;

  -- Every specimen must have a result. Paying for a partially-tested batch
  -- means paying for cubes nobody broke.
  select count(*) into v_missing
    from eworks.samples s
    left join eworks.test_results r on r.sample_id = s.id
   where s.job_id = v_job.id and r.id is null;
  if v_missing > 0 then
    raise exception '% specimen(s) on order % have no result; payment stays held',
      v_missing, p_order_id using errcode = 'check_violation';
  end if;

  update eworks.payments
     set status = 'RELEASED',
         idempotency_key = p_idempotency_key,
         treasury_ref = p_treasury_ref,
         gst_invoice_no = p_gst_invoice_no,
         released_at = now()
   where id = v_pay.id
  returning * into v_pay;

  select ou.path into v_path
    from eworks.test_orders o join eworks.org_units ou on ou.id = o.org_unit_id
   where o.id = p_order_id;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'payment.release', 'payment', v_pay.id, v_path,
          jsonb_build_object('order_id', p_order_id, 'amount_paise', v_pay.amount_paise,
                             'treasury_ref', p_treasury_ref,
                             'idempotency_key', p_idempotency_key));
  return v_pay;
end;
$$;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table eworks.project_parameters enable row level security;
alter table eworks.test_results       enable row level security;
alter table eworks.escalations        enable row level security;
alter table eworks.certificates       enable row level security;
alter table eworks.payments           enable row level security;

grant select on eworks.project_parameters, eworks.test_results,
                eworks.escalations, eworks.certificates, eworks.payments
  to eworks_authenticated;
grant insert on eworks.certificates to eworks_authenticated;
grant update on eworks.escalations to eworks_authenticated;
-- No direct DML on test_results or payments: record_test_result() enforces the
-- custody check and the criteria snapshot; release_payment() enforces the
-- certificate gate and idempotency.

create policy project_parameters_read on eworks.project_parameters
  for select to eworks_authenticated
  using (exists (select 1 from eworks.org_units ou
                  where ou.id = project_parameters.project_id
                    and eworks.has_permission('order.read', ou.path)));

-- Results follow their job's visibility: the vendor that did the work, the
-- technician, and officers in scope.
create policy test_results_read on eworks.test_results
  for select to eworks_authenticated
  using (exists (select 1 from eworks.test_jobs j where j.id = test_results.job_id));

create policy certificates_read on eworks.certificates
  for select to eworks_authenticated
  using (exists (select 1 from eworks.test_jobs j where j.id = certificates.job_id));

create policy certificates_upload on eworks.certificates
  for insert to eworks_authenticated
  with check (exists (select 1 from eworks.test_jobs j
                       join eworks.vendors v on v.id = j.vendor_id
                      where j.id = certificates.job_id
                        and v.owner_user_id = eworks.current_user_id())
              -- A lab may upload a certificate. It may NOT declare its own
              -- signature verified; that is the verifier's job.
              and signature_verified = false);

create policy escalations_read on eworks.escalations
  for select to eworks_authenticated
  using (exists (select 1 from eworks.test_orders o
                  join eworks.org_units ou on ou.id = o.org_unit_id
                 where o.id = escalations.order_id
                   and eworks.has_permission('order.read', ou.path))
         or exists (select 1 from eworks.test_results r
                     join eworks.test_jobs j on j.id = r.job_id
                     join eworks.vendors v on v.id = j.vendor_id
                    where r.id = escalations.result_id
                      and v.owner_user_id = eworks.current_user_id()));

-- Only an engineer holding result.verify closes an escalation.
create policy escalations_resolve on eworks.escalations
  for update to eworks_authenticated
  using (exists (select 1 from eworks.test_orders o
                  join eworks.org_units ou on ou.id = o.org_unit_id
                 where o.id = escalations.order_id
                   and eworks.has_permission('result.verify', ou.path)))
  with check (exists (select 1 from eworks.test_orders o
                       join eworks.org_units ou on ou.id = o.org_unit_id
                      where o.id = escalations.order_id
                        and eworks.has_permission('result.verify', ou.path)));

create policy payments_read on eworks.payments
  for select to eworks_authenticated
  using (exists (select 1 from eworks.vendors v
                  where v.id = payments.vendor_id
                    and v.owner_user_id = eworks.current_user_id())
         or exists (select 1 from eworks.test_orders o
                     join eworks.org_units ou on ou.id = o.org_unit_id
                    where o.id = payments.order_id
                      and eworks.has_permission('order.read', ou.path)));

comment on function eworks.release_payment(uuid, text, text, text) is
  'Idempotent. Gated on a signature-verified certificate and complete results '
  '-- never on passed=true, which would pay labs to report passes.';
