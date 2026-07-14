-- Phase 7: contractors, contracts, BOQ, material delivery + inspection.
--
-- WHY THIS LIVES HERE
--   The contractor / contract / BOQ / budget spine belongs conceptually in the
--   main E-Works platform (this repo is the testing marketplace). By explicit
--   decision it is built here so the flow works end to end against one database.
--   The module deliberately REUSES the marketplace's existing machinery rather
--   than duplicating it: a material that needs testing auto-floats a real
--   `test_order` (float_order), labs bid and certify through the existing flow,
--   and the contractor's payment is held until that certificate is verified --
--   the same "held until a certificate exists" rule as vendor payments.
--
-- THREE-PART PATTERN, everywhere:
--   photo  = evidence   (presence / quantity / condition / GPS / fraud)
--   test   = quality    (the lab certificate decides pass/fail -- never a photo)
--   BOQ    = budget      (rate x quantity, from the contract)
--
-- Approval authority is value-based PWD delegation, expressed as DATA
-- (material_approval_limits), not hardcoded: a delivery of value V may be
-- approved only by someone whose role limit covers V. Separation of duties is
-- enforced -- the engineer who records a delivery can never approve it.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type eworks.contractor_status as enum (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED'
);

create type eworks.contract_status as enum (
  'DRAFT',      -- being assembled by the department
  'FLOATED',    -- open for contractor bids
  'AWARDED',    -- a contractor holds it
  'CANCELLED'
);

create type eworks.material_delivery_status as enum (
  'RECORDED',   -- site engineer logged it; awaiting approval (test runs in parallel)
  'APPROVED',
  'REJECTED'
);

create type eworks.contractor_doc_type as enum (
  'PAN', 'GST_CERTIFICATE', 'LICENCE', 'ADDRESS_PROOF', 'ID_PROOF', 'BANK_PROOF'
);

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------
insert into eworks.roles (code, name, description) values
  ('CONTRACTOR', 'Contractor', 'Registers once, bids for contracts, delivers materials to site.')
on conflict (code) do nothing;

insert into eworks.permissions (code, description) values
  ('contractor.read',    'View contractor registrations in scope'),
  ('contractor.approve', 'Approve/reject a contractor KYC (district officer)'),
  ('contract.read',      'View contracts in scope'),
  ('contract.manage',    'Create/edit contracts and BOQ'),
  ('contract.award',     'Award a contract to a contractor'),
  ('material.record',    'Record a material delivery (site engineer)'),
  ('material.approve',   'Approve a material measurement + money (delegated by value)'),
  ('material.read',      'View material deliveries in scope')
on conflict (code) do nothing;

insert into eworks.role_permissions (role_code, permission_code) values
  -- Contractor holds NO scope permission. It sees open tenders only once APPROVED,
  -- and its own contracts/deliveries, purely through ownership RLS -- never the
  -- officer-style contract.read, which would let an unapproved applicant browse.
  -- Site engineer (AE): the recorder, and the lowest delegation tier.
  ('SITE_ENGINEER', 'material.record'),
  ('SITE_ENGINEER', 'material.read'),
  ('SITE_ENGINEER', 'material.approve'),
  ('SITE_ENGINEER', 'contract.read'),
  -- Executive engineer (EE): the main approver.
  ('EXECUTIVE_ENGINEER', 'material.approve'),
  ('EXECUTIVE_ENGINEER', 'material.read'),
  ('EXECUTIVE_ENGINEER', 'contract.read'),
  ('EXECUTIVE_ENGINEER', 'contract.manage'),
  ('EXECUTIVE_ENGINEER', 'contract.award'),
  ('EXECUTIVE_ENGINEER', 'contractor.read'),
  -- District officer (Superintending Engineer): top delegation tier + contractor KYC.
  ('DISTRICT_OFFICER', 'material.approve'),
  ('DISTRICT_OFFICER', 'material.read'),
  ('DISTRICT_OFFICER', 'contract.read'),
  ('DISTRICT_OFFICER', 'contract.award'),
  ('DISTRICT_OFFICER', 'contract.manage'),
  ('DISTRICT_OFFICER', 'contractor.read'),
  ('DISTRICT_OFFICER', 'contractor.approve'),
  -- Head admin: statewide visibility.
  ('HEAD_ADMIN', 'contractor.read'),
  ('HEAD_ADMIN', 'contract.read'),
  ('HEAD_ADMIN', 'material.read')
on conflict do nothing;

-- Value-based delegation, as configuration. NULL limit = unlimited.
-- Paise (money is always integer paise). Seeded with the agreed starting tiers;
-- a department changes these without a deployment.
create table eworks.material_approval_limits (
  role_code       text primary key references eworks.roles(code) on delete cascade,
  max_value_paise bigint check (max_value_paise is null or max_value_paise > 0),
  updated_at      timestamptz not null default now()
);

insert into eworks.material_approval_limits (role_code, max_value_paise) values
  ('SITE_ENGINEER',      20000000),   -- AE: up to Rs 2,00,000  (2,00,000 x 100 paise)
  ('EXECUTIVE_ENGINEER', 500000000),  -- EE: up to Rs 50,00,000 (50,00,000 x 100 paise)
  ('DISTRICT_OFFICER',   null)        -- SE: unlimited
on conflict (role_code) do nothing;

-- ---------------------------------------------------------------------------
-- Contractors (KYC mirrors the vendor pattern)
-- ---------------------------------------------------------------------------
create table eworks.contractors (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references eworks.user_profiles(id) on delete restrict,
  -- Registration district, exactly like vendors: it scopes the approval queue.
  org_unit_id    uuid not null references eworks.org_units(id) on delete restrict,

  legal_name     text not null check (length(trim(legal_name)) > 0),
  gstin          text not null unique
                   check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan            text not null check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  address        text not null,
  licence_class  text not null,   -- PWD contractor class (I / II / III ...)
  licence_no     text not null,

  status         eworks.contractor_status not null default 'DRAFT',
  approved_by    uuid references eworks.user_profiles(id),
  approved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint contractors_approval_attributed
    check ((status <> 'APPROVED') or (approved_by is not null and approved_at is not null))
);

create index contractors_owner_idx on eworks.contractors (owner_user_id);
create index contractors_org_idx on eworks.contractors (org_unit_id) where status = 'APPROVED';

-- A contractor registers in a DISTRICT (a FK cannot constrain the referenced
-- row's level, so a trigger does).
create or replace function eworks.contractors_district_check()
returns trigger language plpgsql as $$
declare lvl eworks.org_level;
begin
  select level into lvl from eworks.org_units where id = new.org_unit_id;
  if lvl is distinct from 'DISTRICT' then
    raise exception 'contractors.org_unit_id must reference a DISTRICT org_unit, got %', lvl;
  end if;
  return new;
end;
$$;

create trigger contractors_district_trg
  before insert or update of org_unit_id on eworks.contractors
  for each row execute function eworks.contractors_district_check();


create table eworks.contractor_documents (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  doc_type      eworks.contractor_doc_type not null,
  storage_path  text not null,
  mime_type     text not null,
  sha256        bytea not null check (length(sha256) = 32),
  scanned_clean boolean not null default false,
  status        eworks.doc_status not null default 'PENDING',
  reviewed_by   uuid references eworks.user_profiles(id),
  reviewed_at   timestamptz,
  reject_reason text,
  uploaded_at   timestamptz not null default now(),

  constraint contractor_documents_one_live_per_type unique (contractor_id, doc_type),
  constraint contractor_documents_rejection_has_reason
    check (status <> 'REJECTED' or reject_reason is not null)
);

create index contractor_documents_idx on eworks.contractor_documents (contractor_id);

-- ---------------------------------------------------------------------------
-- Contracts + light bidding
-- ---------------------------------------------------------------------------
create table eworks.contracts (
  id            uuid primary key default gen_random_uuid(),
  -- Null until awarded. The winning contractor.
  contractor_id uuid references eworks.contractors(id) on delete restrict,
  -- The work is anchored at a PROJECT org_unit (like test_orders). All scope
  -- checks join org_units on this and test has_permission against its path.
  project_id    uuid not null references eworks.org_units(id) on delete restrict,

  code          text not null unique check (code ~ '^[A-Za-z0-9_-]+$'),
  title         text not null check (length(trim(title)) > 0),
  value_paise   bigint not null check (value_paise > 0),

  status        eworks.contract_status not null default 'DRAFT',
  awarded_by    uuid references eworks.user_profiles(id),
  awarded_at    timestamptz,

  created_by    uuid not null references eworks.user_profiles(id),
  created_at    timestamptz not null default now(),

  constraint contracts_award_attributed check (
    status <> 'AWARDED'
    or (contractor_id is not null and awarded_by is not null and awarded_at is not null)
  )
);

create index contracts_project_idx on eworks.contracts (project_id);
create index contracts_contractor_idx on eworks.contracts (contractor_id);

create or replace function eworks.contracts_project_level_check()
returns trigger language plpgsql as $$
declare lvl eworks.org_level;
begin
  select level into lvl from eworks.org_units where id = new.project_id;
  if lvl is distinct from 'PROJECT' then
    raise exception 'contracts.project_id must reference a PROJECT org_unit, got %', lvl;
  end if;
  return new;
end;
$$;

create trigger contracts_project_trg
  before insert or update of project_id on eworks.contracts
  for each row execute function eworks.contracts_project_level_check();


-- Simple open bids (not sealed -- the sealed commit-reveal scheme is for the
-- price-sensitive test-order auctions; contract tendering here is a lighter flow).
create table eworks.contract_bids (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references eworks.contracts(id) on delete cascade,
  contractor_id uuid not null references eworks.contractors(id) on delete restrict,
  amount_paise  bigint not null check (amount_paise > 0),
  submitted_at  timestamptz not null default now(),
  constraint contract_bids_one_per_contractor unique (contract_id, contractor_id)
);

create index contract_bids_contract_idx on eworks.contract_bids (contract_id);

-- ---------------------------------------------------------------------------
-- Bill of quantities -- the spine that makes budget auto-calculable
-- ---------------------------------------------------------------------------
create table eworks.boq_items (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references eworks.contracts(id) on delete cascade,
  item_no       int not null check (item_no > 0),
  material      text not null check (length(trim(material)) > 0),
  -- Which construction stage this material belongs to (foundation/PCC/column
  -- map onto the existing construction_stage rows). Drives nothing the user
  -- picks -- the stage is context.
  stage_id      uuid references eworks.construction_stage(id) on delete restrict,
  unit          text not null,                       -- bag / MT / cum ...
  quantity      numeric(14,3) not null check (quantity > 0),
  rate_paise    bigint not null check (rate_paise > 0),
  -- The system, not the user, knows whether this material needs a lab test and
  -- which one. If it does, a test order is floated automatically on delivery.
  requires_test boolean not null default false,
  test_id       uuid references eworks.test_catalog(id) on delete restrict,

  constraint boq_items_unique unique (contract_id, item_no),
  constraint boq_test_present check (not requires_test or test_id is not null)
);

create index boq_items_contract_idx on eworks.boq_items (contract_id);

-- ---------------------------------------------------------------------------
-- Material deliveries -- the one thing the site engineer records
-- ---------------------------------------------------------------------------
create table eworks.material_deliveries (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references eworks.contracts(id) on delete restrict,
  boq_item_id      uuid not null references eworks.boq_items(id) on delete restrict,
  project_id       uuid not null references eworks.org_units(id) on delete restrict,

  quantity_received numeric(14,3) not null check (quantity_received > 0),
  -- Rate and amount are SNAPSHOTTED from the BOQ at record time: a later BOQ
  -- revision must not silently change what an approved delivery cost.
  rate_paise       bigint not null check (rate_paise > 0),
  amount_paise     bigint not null check (amount_paise > 0),

  status           eworks.material_delivery_status not null default 'RECORDED',
  -- The test order auto-floated for this delivery, if the material needs one.
  test_order_id    uuid references eworks.test_orders(id) on delete set null,

  gps              geography(Point, 4326),
  device_id        text,

  recorded_by      uuid not null references eworks.user_profiles(id),
  recorded_at      timestamptz not null default now(),
  approved_by      uuid references eworks.user_profiles(id),
  approved_at      timestamptz,
  reject_reason    text,

  constraint deliveries_decision_attributed
    check (status = 'RECORDED' or (approved_by is not null and approved_at is not null)),
  constraint deliveries_reject_has_reason
    check (status <> 'REJECTED' or reject_reason is not null)
);

create index material_deliveries_contract_idx on eworks.material_deliveries (contract_id);
create index material_deliveries_project_idx on eworks.material_deliveries (project_id);
create index material_deliveries_pending_idx on eworks.material_deliveries (project_id)
  where status = 'RECORDED';


create table eworks.material_delivery_photos (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references eworks.material_deliveries(id) on delete cascade,
  storage_path text not null,
  mime_type    text not null,
  -- Globally unique: the same photo can never be presented for two deliveries
  -- (the classic reuse fraud). Same guarantee as site check-in photos.
  sha256       bytea not null unique check (length(sha256) = 32),
  gps          geography(Point, 4326),
  taken_at     timestamptz,
  uploaded_at  timestamptz not null default now()
);

create index material_delivery_photos_idx on eworks.material_delivery_photos (delivery_id);


-- Contractor's money for the delivered material. Held on approval, released only
-- once the lab certificate is verified -- never on a photo, never on approval
-- alone. Same rule as vendor payments (s12).
create table eworks.contractor_payments (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     uuid not null references eworks.material_deliveries(id) on delete restrict,
  contractor_id   uuid not null references eworks.contractors(id) on delete restrict,
  amount_paise    bigint not null check (amount_paise > 0),
  status          eworks.payment_status not null default 'HELD',
  idempotency_key text not null unique,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint contractor_payments_one_per_delivery unique (delivery_id),
  constraint contractor_payments_released_has_time
    check (status <> 'RELEASED' or released_at is not null)
);

-- ---------------------------------------------------------------------------
-- Budget view: used vs remaining, plus over-supply flag per BOQ item
-- ---------------------------------------------------------------------------
create or replace view eworks.contract_budget as
  select
    c.id                         as contract_id,
    c.project_id,
    c.value_paise                as budget_paise,
    coalesce(spent.approved_paise, 0)                as used_paise,
    c.value_paise - coalesce(spent.approved_paise, 0) as remaining_paise
  from eworks.contracts c
  left join lateral (
    select sum(d.amount_paise) as approved_paise
      from eworks.material_deliveries d
     where d.contract_id = c.id and d.status = 'APPROVED'
  ) spent on true;

-- ---------------------------------------------------------------------------
-- Delegation check: may the caller approve a delivery of this value here?
-- ---------------------------------------------------------------------------
-- Stricter than has_permission('material.approve', path): the role that grants
-- reach must ALSO carry a delegation limit that covers the amount. A site
-- engineer (AE) holding material.approve still cannot approve a Rs 60 lakh
-- delivery -- their limit stops at Rs 2 lakh.
create or replace function eworks.can_approve_material(p_target ltree, p_amount bigint)
returns boolean
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from eworks.user_roles ur
      join eworks.org_units ou on ou.id = ur.org_unit_id
      join eworks.role_permissions rp
        on rp.role_code = ur.role_code and rp.permission_code = 'material.approve'
      join eworks.material_approval_limits mal on mal.role_code = ur.role_code
     where ur.user_id = eworks.current_user_id()
       and (ur.expires_at is null or ur.expires_at > now())
       and ou.is_active
       and p_target <@ ou.path
       and (mal.max_value_paise is null or p_amount <= mal.max_value_paise)
  );
$$;

-- ---------------------------------------------------------------------------
-- record_material_delivery: the ONE action the site engineer takes.
-- Snapshots the BOQ rate, and -- if the material needs testing -- floats a real
-- test order to the marketplace automatically. The engineer chooses nothing.
-- ---------------------------------------------------------------------------
create or replace function eworks.record_material_delivery(
  p_boq_item_id  uuid,
  p_quantity     numeric,
  p_lat          double precision default null,
  p_lon          double precision default null,
  p_device_id    text default null,
  p_test_quantity int default 6
)
returns eworks.material_deliveries
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_boq      eworks.boq_items;
  v_contract eworks.contracts;
  v_path     ltree;
  v_delivery eworks.material_deliveries;
  v_amount   bigint;
  v_gps      geography(Point, 4326);
  v_order_id uuid;
  v_stage    uuid;
begin
  select * into v_boq from eworks.boq_items where id = p_boq_item_id;
  if v_boq.id is null then
    raise exception 'unknown BOQ item %', p_boq_item_id;
  end if;
  select * into v_contract from eworks.contracts where id = v_boq.contract_id;
  select path into v_path from eworks.org_units where id = v_contract.project_id;

  if not eworks.has_permission('material.record', v_path) then
    raise exception 'permission denied: material.record at %', v_path
      using errcode = 'insufficient_privilege';
  end if;

  v_amount := round(v_boq.rate_paise * p_quantity);
  v_gps := case when p_lat is null then null
                else st_makepoint(p_lon, p_lat)::geography end;

  insert into eworks.material_deliveries
    (contract_id, boq_item_id, project_id, quantity_received, rate_paise,
     amount_paise, gps, device_id, recorded_by)
  values
    (v_contract.id, v_boq.id, v_contract.project_id, p_quantity, v_boq.rate_paise,
     v_amount, v_gps, p_device_id, eworks.current_user_id())
  returning * into v_delivery;

  -- The system decides testing, not the user. Float a real order automatically.
  if v_boq.requires_test then
    select coalesce(v_boq.stage_id,
                    (select id from eworks.construction_stage order by sequence limit 1))
      into v_stage;

    insert into eworks.test_orders
      (project_id, org_unit_id, milestone, stage_id, site, status, required_by, created_by)
    values
      (v_contract.project_id, v_contract.project_id,
       'Material test: ' || v_boq.material, v_stage,
       coalesce(v_gps, st_makepoint(78.6569, 11.1271)::geography),
       'DRAFT', current_date + 30, eworks.current_user_id())
    returning id into v_order_id;

    insert into eworks.order_items (order_id, test_id, quantity)
    values (v_order_id, v_boq.test_id, p_test_quantity);

    perform eworks.float_order(v_order_id);

    update eworks.material_deliveries set test_order_id = v_order_id
     where id = v_delivery.id returning * into v_delivery;
  end if;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'material.record', 'material_delivery', v_delivery.id, v_path,
          jsonb_build_object('material', v_boq.material, 'quantity', p_quantity,
                             'amount_paise', v_amount, 'test_order_id', v_order_id));
  return v_delivery;
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_material_delivery: the single delegated approval.
-- ---------------------------------------------------------------------------
create or replace function eworks.approve_material_delivery(
  p_delivery_id uuid,
  p_approve     boolean,
  p_reason      text default null
)
returns eworks.material_deliveries
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_d        eworks.material_deliveries;
  v_path     ltree;
  v_contract eworks.contracts;
begin
  select * into v_d from eworks.material_deliveries where id = p_delivery_id for update;
  if v_d.id is null then
    raise exception 'unknown delivery %', p_delivery_id;
  end if;
  if v_d.status <> 'RECORDED' then
    raise exception 'delivery % is already %', p_delivery_id, v_d.status;
  end if;

  select path into v_path from eworks.org_units where id = v_d.project_id;

  -- Separation of duties: the recorder is a witness, not the approver.
  if v_d.recorded_by = eworks.current_user_id() then
    raise exception 'the engineer who recorded a delivery cannot approve it'
      using errcode = 'insufficient_privilege';
  end if;

  -- Value-based delegation: your role limit must cover the amount.
  if not eworks.can_approve_material(v_path, v_d.amount_paise) then
    raise exception 'permission denied: delegation limit does not cover this value (% paise)',
      v_d.amount_paise using errcode = 'insufficient_privilege';
  end if;

  if p_approve then
    select * into v_contract from eworks.contracts where id = v_d.contract_id;
    if v_contract.contractor_id is null then
      raise exception 'contract % has no awarded contractor; cannot hold payment', v_contract.id;
    end if;

    update eworks.material_deliveries
       set status = 'APPROVED', approved_by = eworks.current_user_id(), approved_at = now()
     where id = p_delivery_id returning * into v_d;

    -- Hold the contractor's money. Released only once the certificate verifies.
    insert into eworks.contractor_payments (delivery_id, contractor_id, amount_paise, idempotency_key)
    values (v_d.id, v_contract.contractor_id, v_d.amount_paise, 'material-hold:' || v_d.id::text)
    on conflict (delivery_id) do nothing;

    insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
    values (eworks.current_user_id(), 'material.approve', 'material_delivery', v_d.id, v_path,
            jsonb_build_object('amount_paise', v_d.amount_paise));
  else
    if p_reason is null then
      raise exception 'a rejection needs a reason';
    end if;
    update eworks.material_deliveries
       set status = 'REJECTED', approved_by = eworks.current_user_id(),
           approved_at = now(), reject_reason = p_reason
     where id = p_delivery_id returning * into v_d;

    insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
    values (eworks.current_user_id(), 'material.reject', 'material_delivery', v_d.id, v_path,
            jsonb_build_object('reason', p_reason));
  end if;

  return v_d;
end;
$$;

-- ---------------------------------------------------------------------------
-- release_material_payment: idempotent, gated on the certificate (not the photo,
-- not the approval alone). A material that needs a test must have a verified
-- certificate and no confirmed failure before its contractor is paid.
-- ---------------------------------------------------------------------------
create or replace function eworks.release_material_payment(
  p_delivery_id     uuid,
  p_idempotency_key text
)
returns eworks.contractor_payments
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_pay  eworks.contractor_payments;
  v_d    eworks.material_deliveries;
  v_boq  eworks.boq_items;
  v_path ltree;
  v_cert eworks.certificates;
begin
  select * into v_d from eworks.material_deliveries where id = p_delivery_id;
  if v_d.id is null then
    raise exception 'unknown delivery %', p_delivery_id;
  end if;
  select path into v_path from eworks.org_units where id = v_d.project_id;

  if not eworks.has_permission('material.approve', v_path) then
    raise exception 'permission denied: releasing material payment requires material.approve'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_pay from eworks.contractor_payments where delivery_id = p_delivery_id for update;
  if v_pay.id is null then
    raise exception 'no payment held for delivery %', p_delivery_id;
  end if;
  if v_pay.status = 'RELEASED' then
    if v_pay.idempotency_key = p_idempotency_key then
      return v_pay;                                   -- idempotent replay
    end if;
    raise exception 'payment for delivery % already released under a different key', p_delivery_id;
  end if;

  if v_d.status <> 'APPROVED' then
    raise exception 'delivery % is % -- payment stays held', p_delivery_id, v_d.status
      using errcode = 'check_violation';
  end if;

  select * into v_boq from eworks.boq_items where id = v_d.boq_item_id;
  if v_boq.requires_test then
    if v_d.test_order_id is null then
      raise exception 'material needs a test but none was ordered' using errcode = 'check_violation';
    end if;
    select c.* into v_cert
      from eworks.certificates c
      join eworks.test_jobs j on j.id = c.job_id
     where j.order_id = v_d.test_order_id;
    if v_cert.id is null or not v_cert.signature_verified then
      raise exception 'certificate for delivery % is not verified; payment stays held', p_delivery_id
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from eworks.test_results r
        join eworks.test_jobs j on j.id = r.job_id
       where j.order_id = v_d.test_order_id and not r.passed and not r.is_provisional
    ) then
      raise exception 'material failed its test; payment blocked' using errcode = 'check_violation';
    end if;
  end if;

  update eworks.contractor_payments
     set status = 'RELEASED', idempotency_key = p_idempotency_key, released_at = now()
   where id = v_pay.id returning * into v_pay;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'material.payment_release', 'contractor_payment', v_pay.id, v_path,
          jsonb_build_object('delivery_id', p_delivery_id, 'amount_paise', v_pay.amount_paise));
  return v_pay;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table eworks.material_approval_limits enable row level security;
alter table eworks.contractors              enable row level security;
alter table eworks.contractor_documents     enable row level security;
alter table eworks.contracts                enable row level security;
alter table eworks.contract_bids            enable row level security;
alter table eworks.boq_items                enable row level security;
alter table eworks.material_deliveries      enable row level security;
alter table eworks.material_delivery_photos enable row level security;
alter table eworks.contractor_payments      enable row level security;

grant select on eworks.material_approval_limits to eworks_authenticated;
grant select, insert, update on eworks.contractors to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_documents to eworks_authenticated;
grant select, insert, update on eworks.contracts to eworks_authenticated;
-- update: a contractor may revise its own bid (ON CONFLICT DO UPDATE).
grant select, insert, update on eworks.contract_bids to eworks_authenticated;
grant select, insert, update, delete on eworks.boq_items to eworks_authenticated;
-- No direct DML on deliveries / payments: the functions enforce the snapshot,
-- the auto-test, delegation, separation of duties, and the certificate gate.
grant select on eworks.material_deliveries to eworks_authenticated;
grant select, insert on eworks.material_delivery_photos to eworks_authenticated;
grant select on eworks.contractor_payments to eworks_authenticated;

-- Delegation limits are readable config.
create policy material_limits_read on eworks.material_approval_limits
  for select to eworks_authenticated using (eworks.current_user_id() is not null);

-- Contractors: owner sees own; officers with contractor.read see those in their
-- district subtree. Mirrors vendors_read (scope is not permission -- a contractor
-- role must not read competitors, so the officer branch tests contractor.read).
create policy contractors_read on eworks.contractors
  for select to eworks_authenticated
  using (
    owner_user_id = eworks.current_user_id()
    or exists (select 1 from eworks.org_units ou
                where ou.id = contractors.org_unit_id
                  and eworks.has_permission('contractor.read', ou.path))
  );

create policy contractors_self_insert on eworks.contractors
  for insert to eworks_authenticated
  with check (owner_user_id = eworks.current_user_id() and status = 'DRAFT');

create policy contractors_self_update on eworks.contractors
  for update to eworks_authenticated
  using (owner_user_id = eworks.current_user_id() and status in ('DRAFT', 'REJECTED'))
  with check (owner_user_id = eworks.current_user_id() and status in ('DRAFT', 'SUBMITTED'));

create policy contractors_officer_update on eworks.contractors
  for update to eworks_authenticated
  using (exists (select 1 from eworks.org_units ou
                  where ou.id = contractors.org_unit_id
                    and eworks.has_permission('contractor.approve', ou.path)))
  with check (exists (select 1 from eworks.org_units ou
                       where ou.id = contractors.org_unit_id
                         and eworks.has_permission('contractor.approve', ou.path)));

create policy contractor_documents_rw on eworks.contractor_documents
  for all to eworks_authenticated
  using (exists (select 1 from eworks.contractors c
                  where c.id = contractor_documents.contractor_id
                    and (c.owner_user_id = eworks.current_user_id()
                         or exists (select 1 from eworks.org_units ou
                                     where ou.id = c.org_unit_id
                                       and eworks.has_permission('contractor.read', ou.path)))))
  with check (exists (select 1 from eworks.contractors c
                       where c.id = contractor_documents.contractor_id
                         and c.owner_user_id = eworks.current_user_id()));

-- Contracts: officers in scope (contract.read), plus the awarded contractor and
-- any contractor while the contract is FLOATED (so they can see it to bid).
create policy contracts_read on eworks.contracts
  for select to eworks_authenticated
  using (
    exists (select 1 from eworks.org_units ou
             where ou.id = contracts.project_id
               and eworks.has_permission('contract.read', ou.path))
    or exists (select 1 from eworks.contractors c
                where c.id = contracts.contractor_id
                  and c.owner_user_id = eworks.current_user_id())
    or (contracts.status = 'FLOATED'
        and exists (select 1 from eworks.contractors c
                     where c.owner_user_id = eworks.current_user_id()
                       and c.status = 'APPROVED'))
  );

create policy contracts_manage on eworks.contracts
  for all to eworks_authenticated
  using (exists (select 1 from eworks.org_units ou
                  where ou.id = contracts.project_id
                    and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.org_units ou
                       where ou.id = contracts.project_id
                         and eworks.has_permission('contract.manage', ou.path)));

-- Bids: a contractor sees/places only its own; officers with contract.award see
-- all bids for contracts in their scope.
create policy contract_bids_owner on eworks.contract_bids
  for all to eworks_authenticated
  using (exists (select 1 from eworks.contractors c
                  where c.id = contract_bids.contractor_id
                    and c.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.contractors c
                       where c.id = contract_bids.contractor_id
                         and c.owner_user_id = eworks.current_user_id()));

create policy contract_bids_officer_read on eworks.contract_bids
  for select to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct
                  join eworks.org_units ou on ou.id = ct.project_id
                 where ct.id = contract_bids.contract_id
                   and eworks.has_permission('contract.award', ou.path)));

-- BOQ inherits the contract's readability; only contract.manage writes it.
create policy boq_read on eworks.boq_items
  for select to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct
                  where ct.id = boq_items.contract_id));

create policy boq_manage on eworks.boq_items
  for all to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct
                  join eworks.org_units ou on ou.id = ct.project_id
                 where ct.id = boq_items.contract_id
                   and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.contracts ct
                       join eworks.org_units ou on ou.id = ct.project_id
                      where ct.id = boq_items.contract_id
                        and eworks.has_permission('contract.manage', ou.path)));

-- Deliveries: officers with material.read in scope, the recorder, and the
-- contractor whose contract it is.
create policy deliveries_read on eworks.material_deliveries
  for select to eworks_authenticated
  using (
    recorded_by = eworks.current_user_id()
    or exists (select 1 from eworks.org_units ou
                where ou.id = material_deliveries.project_id
                  and eworks.has_permission('material.read', ou.path))
    or exists (select 1 from eworks.contracts ct
                join eworks.contractors c on c.id = ct.contractor_id
               where ct.id = material_deliveries.contract_id
                 and c.owner_user_id = eworks.current_user_id())
  );

-- Photos follow their delivery's visibility; only the recorder attaches them,
-- and only while the delivery is still awaiting approval.
create policy delivery_photos_read on eworks.material_delivery_photos
  for select to eworks_authenticated
  using (exists (select 1 from eworks.material_deliveries d
                  where d.id = material_delivery_photos.delivery_id));

create policy delivery_photos_insert on eworks.material_delivery_photos
  for insert to eworks_authenticated
  with check (exists (select 1 from eworks.material_deliveries d
                       where d.id = material_delivery_photos.delivery_id
                         and d.recorded_by = eworks.current_user_id()
                         and d.status = 'RECORDED'));

-- Payments: the contractor sees its own; officers with material.read in scope.
create policy contractor_payments_read on eworks.contractor_payments
  for select to eworks_authenticated
  using (
    exists (select 1 from eworks.contractors c
             where c.id = contractor_payments.contractor_id
               and c.owner_user_id = eworks.current_user_id())
    or exists (select 1 from eworks.material_deliveries d
                join eworks.org_units ou on ou.id = d.project_id
               where d.id = contractor_payments.delivery_id
                 and eworks.has_permission('material.read', ou.path))
  );

comment on function eworks.record_material_delivery(uuid, numeric, double precision, double precision, text, int) is
  'The site engineer''s one action: snapshot BOQ rate + quantity, and auto-float '
  'a real test order when the material requires testing. The user chooses nothing.';
comment on function eworks.can_approve_material(ltree, bigint) is
  'Value-based PWD delegation as data: the caller must hold material.approve at a '
  'unit dominating the target AND carry a delegation limit covering the amount.';
