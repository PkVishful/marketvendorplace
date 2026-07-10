-- Phase 1: vendor onboarding, KYC, capabilities, pricing (master prompt s6, s13).
--
-- PostGIS enters here, and only here, because this is the first table with a
-- geometry. s11 calls the radius query "the single most performance-critical
-- decision" -- it runs on every floated order.

create extension if not exists postgis;

-- Runtime settings. Anything a department might want to change without a
-- deployment lives here rather than in a constant (s0: no hardcoded business
-- logic).
create table eworks.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into eworks.settings (key, value) values
  -- Upper bound used to make the radius search index-assisted. See
  -- eworks.match_vendors_for_test().
  ('vendor_max_service_radius_km', '300'::jsonb)
on conflict (key) do nothing;


create type eworks.vendor_status as enum (
  'DRAFT',         -- vendor is filling the KYC wizard
  'SUBMITTED',     -- awaiting district officer review
  'APPROVED',      -- may bid
  'REJECTED',
  'SUSPENDED'      -- was approved, now barred (fraud, lapsed accreditation)
);

create table eworks.vendors (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references eworks.user_profiles(id) on delete restrict,

  -- The district the vendor is registered in. This is what scopes the approval
  -- queue: a Coimbatore officer approves Coimbatore vendors. It does NOT limit
  -- where the vendor can work -- that is geography, below.
  org_unit_id    uuid not null references eworks.org_units(id) on delete restrict,

  legal_name     text not null check (length(trim(legal_name)) > 0),

  -- GSTIN: 2-digit state code, 10-char PAN, entity number, 'Z', checksum.
  gstin          text not null unique
                   check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan            text not null
                   check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),

  address        text not null,

  -- geography, not geometry: distances come back in metres on the spheroid, so
  -- a 50 km service radius means 50 km rather than 50 degrees of arc.
  location       geography(Point, 4326) not null,
  service_radius_km numeric(6,2) not null
                   check (service_radius_km > 0 and service_radius_km <= 1000),

  is_govt_approved boolean not null default false,   -- PWD empanelment
  nabl_no        text,
  nabl_valid_until date,

  status         eworks.vendor_status not null default 'DRAFT',
  approved_by    uuid references eworks.user_profiles(id),
  approved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- An APPROVED vendor must carry the identity of whoever approved it. Without
  -- this an approval has no accountable human behind it.
  constraint vendors_approval_attributed
    check ((status <> 'APPROVED') or (approved_by is not null and approved_at is not null)),

  -- A NABL number without an expiry cannot be validity-checked at bid time.
  constraint vendors_nabl_has_expiry
    check ((nabl_no is null) = (nabl_valid_until is null))
);

-- s11, highest priority: vendors within radius doing test X with valid NABL.
create index vendors_location_gist on eworks.vendors using gist (location);
-- Partial index: the radius query only ever considers approved vendors.
create index vendors_approved_idx on eworks.vendors (org_unit_id)
  where status = 'APPROVED';
create index vendors_owner_idx on eworks.vendors (owner_user_id);

-- A vendor registers in a DISTRICT. Expressed as a trigger because a foreign
-- key cannot constrain the referenced row's level.
create or replace function eworks.vendors_district_check()
returns trigger language plpgsql as $$
declare lvl eworks.org_level;
begin
  select level into lvl from eworks.org_units where id = new.org_unit_id;
  if lvl is distinct from 'DISTRICT' then
    raise exception 'vendors.org_unit_id must reference a DISTRICT org_unit, got %', lvl;
  end if;
  return new;
end;
$$;

create trigger vendors_district_trg
  before insert or update of org_unit_id on eworks.vendors
  for each row execute function eworks.vendors_district_check();


-- KYC documents (s8: "each shown to admin as a viewable image with
-- approve/reject").
create type eworks.vendor_doc_type as enum (
  'PAN_COMPANY', 'PAN_PROPRIETOR', 'GST_CERTIFICATE', 'NABL_CERTIFICATE',
  'NABL_SCOPE', 'REGISTRATION_CERTIFICATE', 'ADDRESS_PROOF',
  'ID_PROOF', 'SELFIE', 'BANK_PROOF'
);

create type eworks.doc_status as enum ('PENDING', 'APPROVED', 'REJECTED');

create table eworks.vendor_documents (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references eworks.vendors(id) on delete cascade,
  doc_type      eworks.vendor_doc_type not null,

  storage_path  text not null,
  mime_type     text not null,
  -- s9 requires MIME + magic-byte validation and a virus scan before a file is
  -- readable. The hash is stored so the reviewed bytes and the served bytes can
  -- be proven identical -- a document cannot be swapped after approval.
  sha256        bytea not null check (length(sha256) = 32),
  scanned_clean boolean not null default false,

  status        eworks.doc_status not null default 'PENDING',
  reviewed_by   uuid references eworks.user_profiles(id),
  reviewed_at   timestamptz,
  reject_reason text,

  uploaded_at   timestamptz not null default now(),

  constraint vendor_documents_one_live_per_type unique (vendor_id, doc_type),
  constraint vendor_documents_rejection_has_reason
    check (status <> 'REJECTED' or reject_reason is not null),
  constraint vendor_documents_review_attributed
    check (status = 'PENDING' or (reviewed_by is not null and reviewed_at is not null))
);

create index vendor_documents_vendor_idx on eworks.vendor_documents (vendor_id);


-- Accreditation per test, with a validity window (s14:
-- "NABL-eligibility-per-test"). s7: expired NABL/PWD auto-rejects at bid time.
create table eworks.vendor_test_capabilities (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references eworks.vendors(id) on delete cascade,
  test_id         uuid not null references eworks.test_catalog(id) on delete restrict,

  is_nabl_accredited boolean not null default false,
  nabl_scope_ref  text,
  accredited_from date,
  accredited_to   date,

  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),

  constraint vtc_unique unique (vendor_id, test_id),
  constraint vtc_window_ordered
    check (accredited_from is null or accredited_to is null or accredited_from <= accredited_to),
  -- Claiming accreditation without a window makes expiry unenforceable.
  constraint vtc_accredited_has_window
    check (not is_nabl_accredited or (accredited_from is not null and accredited_to is not null))
);

create index vtc_lookup_idx on eworks.vendor_test_capabilities (test_id, vendor_id)
  where is_active;


-- Pricing. Money is integer paise, never floating point.
create table eworks.vendor_test_pricing (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references eworks.vendors(id) on delete cascade,
  test_id        uuid not null references eworks.test_catalog(id) on delete restrict,
  price_paise    bigint not null check (price_paise > 0),
  effective_from date not null default current_date,
  effective_to   date,

  constraint vtp_window_ordered
    check (effective_to is null or effective_from <= effective_to)
);

create index vtp_lookup_idx on eworks.vendor_test_pricing (vendor_id, test_id);


-- ---------------------------------------------------------------------------
-- Qualification and matching
-- ---------------------------------------------------------------------------

-- Is this vendor technically qualified to perform this test on this date?
-- Single source of truth: the bid-time eligibility lock (s7) and the matching
-- broadcast (s7 step 2) must never disagree, so both call this.
create or replace function eworks.vendor_qualified_for(
  p_vendor_id uuid,
  p_test_id   uuid,
  p_on_date   date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from eworks.vendors v
      join eworks.vendor_test_capabilities c
        on c.vendor_id = v.id and c.test_id = p_test_id and c.is_active
      join eworks.test_catalog t on t.id = p_test_id
     where v.id = p_vendor_id
       and v.status = 'APPROVED'
       and t.is_active
       -- If the catalog says the test needs NABL, the vendor must hold live
       -- accreditation covering p_on_date. An expired certificate disqualifies.
       and (
         not t.requires_nabl
         or (c.is_nabl_accredited
             and c.accredited_from <= p_on_date
             and c.accredited_to   >= p_on_date
             and v.nabl_valid_until >= p_on_date)
       )
  );
$$;

-- Vendors who can service a site for a given test.
--
-- The radius is per-vendor (`service_radius_km`), which a plain GiST index
-- cannot bound on its own. The `max_radius` term is a constant, so PostGIS can
-- use the index to reduce the candidate set; the per-vendor term then filters
-- exactly. Dropping the constant term would still be correct, but would degrade
-- into a sequential scan over every vendor in the state.
create or replace function eworks.match_vendors_for_test(
  p_test_id uuid,
  p_site    geography(Point, 4326),
  p_on_date date default current_date
)
returns table (vendor_id uuid, distance_m double precision)
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select v.id, st_distance(v.location, p_site)
    from eworks.vendors v
   where v.status = 'APPROVED'
     and st_dwithin(v.location, p_site,
           (select (value #>> '{}')::numeric from eworks.settings
             where key = 'vendor_max_service_radius_km') * 1000)
     and st_dwithin(v.location, p_site, v.service_radius_km * 1000)
     and eworks.vendor_qualified_for(v.id, p_test_id, p_on_date)
   order by 2;
$$;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table eworks.vendors                  enable row level security;
alter table eworks.vendor_documents         enable row level security;
alter table eworks.vendor_test_capabilities enable row level security;
alter table eworks.vendor_test_pricing      enable row level security;
alter table eworks.settings                 enable row level security;

grant select, insert, update on eworks.vendors to eworks_authenticated;
grant select, insert, update, delete on eworks.vendor_documents to eworks_authenticated;
grant select, insert, update, delete on eworks.vendor_test_capabilities to eworks_authenticated;
grant select, insert, update, delete on eworks.vendor_test_pricing to eworks_authenticated;
grant select on eworks.settings to eworks_authenticated;

create policy settings_read on eworks.settings
  for select to eworks_authenticated using (eworks.current_user_id() is not null);

-- A vendor reads its own row. An officer reads vendors registered inside their
-- org subtree. Nobody else sees anything -- in particular, one vendor can never
-- read another vendor's row, which is what keeps the bidding field blind.
--
-- The officer branch tests `vendor.read`, NOT `in_scope()`. Scope is not
-- permission: a lab vendor holds a LAB_VENDOR role anchored at its own
-- district, so `in_scope('TN.COIMBATORE')` is true for them, and an in_scope
-- check here would let every Coimbatore lab enumerate its competitors.
-- LAB_VENDOR is deliberately not granted `vendor.read`.
create policy vendors_read on eworks.vendors
  for select to eworks_authenticated
  using (
    owner_user_id = eworks.current_user_id()
    or exists (select 1 from eworks.org_units ou
                where ou.id = vendors.org_unit_id
                  and eworks.has_permission('vendor.read', ou.path))
  );

create policy vendors_self_insert on eworks.vendors
  for insert to eworks_authenticated
  with check (owner_user_id = eworks.current_user_id() and status = 'DRAFT');

-- The critical write rule. A vendor may edit its own row only while it is
-- still DRAFT or REJECTED, and may never move itself to APPROVED. Only a
-- holder of `vendor.approve` in the vendor's district can change status.
--
-- USING selects which rows may be updated; WITH CHECK validates the result.
-- Both are needed: USING alone would let a vendor write itself into APPROVED.
create policy vendors_self_update on eworks.vendors
  for update to eworks_authenticated
  using (owner_user_id = eworks.current_user_id()
         and status in ('DRAFT', 'REJECTED'))
  with check (owner_user_id = eworks.current_user_id()
              and status in ('DRAFT', 'SUBMITTED'));

create policy vendors_officer_update on eworks.vendors
  for update to eworks_authenticated
  using (exists (select 1 from eworks.org_units ou
                  where ou.id = vendors.org_unit_id
                    and eworks.has_permission('vendor.approve', ou.path)))
  with check (exists (select 1 from eworks.org_units ou
                       where ou.id = vendors.org_unit_id
                         and eworks.has_permission('vendor.approve', ou.path)));

-- Documents follow their vendor.
create policy vendor_documents_read on eworks.vendor_documents
  for select to eworks_authenticated
  using (exists (select 1 from eworks.vendors v where v.id = vendor_documents.vendor_id));

create policy vendor_documents_owner_write on eworks.vendor_documents
  for all to eworks_authenticated
  using (exists (select 1 from eworks.vendors v
                  where v.id = vendor_documents.vendor_id
                    and v.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.vendors v
                       where v.id = vendor_documents.vendor_id
                         and v.owner_user_id = eworks.current_user_id()));

create policy vendor_documents_officer_review on eworks.vendor_documents
  for update to eworks_authenticated
  using (exists (select 1 from eworks.vendors v join eworks.org_units ou on ou.id = v.org_unit_id
                  where v.id = vendor_documents.vendor_id
                    and eworks.has_permission('vendor.approve', ou.path)));

-- Capabilities are visible to whoever can see the vendor; only the owner edits.
create policy vtc_read on eworks.vendor_test_capabilities
  for select to eworks_authenticated
  using (exists (select 1 from eworks.vendors v where v.id = vendor_test_capabilities.vendor_id));

create policy vtc_owner_write on eworks.vendor_test_capabilities
  for all to eworks_authenticated
  using (exists (select 1 from eworks.vendors v
                  where v.id = vendor_test_capabilities.vendor_id
                    and v.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.vendors v
                       where v.id = vendor_test_capabilities.vendor_id
                         and v.owner_user_id = eworks.current_user_id()));

-- Pricing is commercially sensitive. A vendor sees ONLY its own prices. An
-- officer must not browse the price list either -- that would leak the bidding
-- field before close. Prices surface through the sealed-bid flow, not here.
create policy vtp_owner_only on eworks.vendor_test_pricing
  for all to eworks_authenticated
  using (exists (select 1 from eworks.vendors v
                  where v.id = vendor_test_pricing.vendor_id
                    and v.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.vendors v
                       where v.id = vendor_test_pricing.vendor_id
                         and v.owner_user_id = eworks.current_user_id()));

comment on function eworks.match_vendors_for_test(uuid, geography, date) is
  'Approved, qualified vendors whose service radius covers the site. Index-'
  'assisted via the constant max-radius bound in eworks.settings.';
