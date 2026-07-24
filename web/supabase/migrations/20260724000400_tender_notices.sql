-- Works-tender Phase 1: notice & eligibility. Extends the contracts layer.
create type eworks.tender_notice_status as enum ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED');

create table eworks.sanctions (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null unique references eworks.contracts(id) on delete cascade,
  sanctioned_amount_paise bigint not null check (sanctioned_amount_paise > 0),
  order_no      text not null check (length(trim(order_no)) > 0),
  sanctioned_by uuid not null references eworks.user_profiles(id),
  sanctioned_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table eworks.tender_notices (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null unique references eworks.contracts(id) on delete cascade,
  notice_no     text not null check (length(trim(notice_no)) > 0),
  scope_summary text not null check (length(trim(scope_summary)) > 0),
  estimated_value_paise bigint not null check (estimated_value_paise > 0),
  completion_period_days int not null check (completion_period_days > 0),
  emd_amount_paise bigint not null check (emd_amount_paise >= 0),
  publish_at         timestamptz,
  query_deadline_at  timestamptz,
  submission_close_at timestamptz,
  technical_opening_at timestamptz,
  financial_opening_at timestamptz,
  status        eworks.tender_notice_status not null default 'DRAFT',
  published_by  uuid references eworks.user_profiles(id),
  published_at  timestamptz,
  created_by    uuid not null references eworks.user_profiles(id),
  created_at    timestamptz not null default now(),
  -- Key dates, when all present, must be ordered.
  constraint tender_notice_dates_ordered check (
    submission_close_at is null or technical_opening_at is null
    or (submission_close_at <= technical_opening_at
        and (financial_opening_at is null or technical_opening_at <= financial_opening_at))
  )
);

create table eworks.tender_eligibility_criteria (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null references eworks.tender_notices(id) on delete cascade,
  seq         int not null check (seq >= 0),
  label       text not null check (length(trim(label)) > 0),
  description text not null default '',
  kind        text not null default 'general',
  created_at  timestamptz not null default now(),
  unique (notice_id, seq)
);

create table eworks.tender_corrigenda (
  id            uuid primary key default gen_random_uuid(),
  notice_id     uuid not null references eworks.tender_notices(id) on delete cascade,
  corrigendum_no int not null check (corrigendum_no > 0),
  summary       text not null check (length(trim(summary)) > 0),
  changes       jsonb not null default '{}'::jsonb,
  issued_by     uuid not null references eworks.user_profiles(id),
  issued_at     timestamptz not null default now(),
  unique (notice_id, corrigendum_no)
);

create table eworks.contractor_experience (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  work_name     text not null check (length(trim(work_name)) > 0),
  client_name   text not null default '',
  value_paise   bigint not null check (value_paise > 0),
  completed_on  date,
  completion_doc_path text,
  created_at    timestamptz not null default now()
);

create table eworks.contractor_machinery (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  quantity      int not null check (quantity > 0),
  capacity      text not null default '',
  created_at    timestamptz not null default now()
);

create table eworks.contractor_engineers (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  qualification text not null default '',
  role          text not null default '',
  created_at    timestamptz not null default now()
);

create index tender_notices_contract_idx on eworks.tender_notices (contract_id);
create index tender_notices_status_idx on eworks.tender_notices (status);
create index tender_criteria_notice_idx on eworks.tender_eligibility_criteria (notice_id);
create index tender_corrigenda_notice_idx on eworks.tender_corrigenda (notice_id);
create index contractor_experience_idx on eworks.contractor_experience (contractor_id);
create index contractor_machinery_idx on eworks.contractor_machinery (contractor_id);
create index contractor_engineers_idx on eworks.contractor_engineers (contractor_id);

alter table eworks.sanctions enable row level security;
alter table eworks.tender_notices enable row level security;
alter table eworks.tender_eligibility_criteria enable row level security;
alter table eworks.tender_corrigenda enable row level security;
alter table eworks.contractor_experience enable row level security;
alter table eworks.contractor_machinery enable row level security;
alter table eworks.contractor_engineers enable row level security;

grant select, insert, update on eworks.sanctions to eworks_authenticated;
grant select, insert, update on eworks.tender_notices to eworks_authenticated;
grant select, insert, update, delete on eworks.tender_eligibility_criteria to eworks_authenticated;
grant select, insert on eworks.tender_corrigenda to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_experience to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_machinery to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_engineers to eworks_authenticated;

-- Management tables: in-scope contract.manage officers, via the parent contract's project path.
-- (Sanction insert also happens through record_sanction(); this policy lets the authoring view read.)
create policy sanctions_manage on eworks.sanctions for all to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                  where ct.id = sanctions.contract_id and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                       where ct.id = sanctions.contract_id and eworks.has_permission('contract.manage', ou.path)));

create policy tender_notices_manage on eworks.tender_notices for all to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                  where ct.id = tender_notices.contract_id and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                       where ct.id = tender_notices.contract_id and eworks.has_permission('contract.manage', ou.path)));

create policy tender_criteria_manage on eworks.tender_eligibility_criteria for all to eworks_authenticated
  using (exists (select 1 from eworks.tender_notices tn join eworks.contracts ct on ct.id = tn.contract_id
                  join eworks.org_units ou on ou.id = ct.project_id
                  where tn.id = tender_eligibility_criteria.notice_id and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.tender_notices tn join eworks.contracts ct on ct.id = tn.contract_id
                       join eworks.org_units ou on ou.id = ct.project_id
                       where tn.id = tender_eligibility_criteria.notice_id and eworks.has_permission('contract.manage', ou.path)));

create policy tender_corrigenda_read on eworks.tender_corrigenda for select to eworks_authenticated
  using (exists (select 1 from eworks.tender_notices tn join eworks.contracts ct on ct.id = tn.contract_id
                  join eworks.org_units ou on ou.id = ct.project_id
                  where tn.id = tender_corrigenda.notice_id and eworks.has_permission('contract.manage', ou.path)));
-- No INSERT policy: corrigenda are written only by issue_corrigendum() (security definer).

-- Contractor child tables: a contractor manages only its own rows; in-scope officers may read.
create policy contractor_experience_own on eworks.contractor_experience for all to eworks_authenticated
  using (exists (select 1 from eworks.contractors c where c.id = contractor_experience.contractor_id and c.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.contractors c where c.id = contractor_experience.contractor_id and c.owner_user_id = eworks.current_user_id()));
create policy contractor_experience_officer_read on eworks.contractor_experience for select to eworks_authenticated
  using (exists (select 1 from eworks.contractors c join eworks.org_units ou on ou.id = c.org_unit_id
                  where c.id = contractor_experience.contractor_id and eworks.has_permission('contractor.read', ou.path)));

create policy contractor_machinery_own on eworks.contractor_machinery for all to eworks_authenticated
  using (exists (select 1 from eworks.contractors c where c.id = contractor_machinery.contractor_id and c.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.contractors c where c.id = contractor_machinery.contractor_id and c.owner_user_id = eworks.current_user_id()));
create policy contractor_machinery_officer_read on eworks.contractor_machinery for select to eworks_authenticated
  using (exists (select 1 from eworks.contractors c join eworks.org_units ou on ou.id = c.org_unit_id
                  where c.id = contractor_machinery.contractor_id and eworks.has_permission('contractor.read', ou.path)));

create policy contractor_engineers_own on eworks.contractor_engineers for all to eworks_authenticated
  using (exists (select 1 from eworks.contractors c where c.id = contractor_engineers.contractor_id and c.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.contractors c where c.id = contractor_engineers.contractor_id and c.owner_user_id = eworks.current_user_id()));
create policy contractor_engineers_officer_read on eworks.contractor_engineers for select to eworks_authenticated
  using (exists (select 1 from eworks.contractors c join eworks.org_units ou on ou.id = c.org_unit_id
                  where c.id = contractor_engineers.contractor_id and eworks.has_permission('contractor.read', ou.path)));
