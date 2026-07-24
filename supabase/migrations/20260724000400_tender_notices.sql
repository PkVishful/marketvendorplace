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

-- Sanction: only a contract.manage officer in scope; append audit.
create or replace function eworks.record_sanction(p_contract_id uuid, p_amount_paise bigint, p_order_no text)
returns uuid language plpgsql security definer set search_path = eworks, public, extensions, pg_temp as $$
declare v_path ltree; v_id uuid;
begin
  select ou.path into v_path from eworks.contracts ct join eworks.org_units ou on ou.id=ct.project_id where ct.id=p_contract_id;
  if v_path is null then raise exception 'contract % not found', p_contract_id; end if;
  if not eworks.has_permission('contract.manage', v_path) then raise exception 'not authorized to sanction'; end if;
  insert into eworks.sanctions (contract_id, sanctioned_amount_paise, order_no, sanctioned_by)
  values (p_contract_id, p_amount_paise, p_order_no, eworks.current_user_id())
  on conflict (contract_id) do update set sanctioned_amount_paise=excluded.sanctioned_amount_paise,
    order_no=excluded.order_no, sanctioned_by=excluded.sanctioned_by, sanctioned_at=now()
  returning id into v_id;
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'tender.sanction', 'contract', p_contract_id, v_path,
          jsonb_build_object('amount_paise', p_amount_paise, 'order_no', p_order_no));
  return v_id;
end; $$;

-- Guard: no notice may reach PUBLISHED without a sanction (unbypassable).
create or replace function eworks.tender_notice_publish_guard()
returns trigger language plpgsql as $$
begin
  if new.status='PUBLISHED' and old.status is distinct from 'PUBLISHED' then
    if not exists (select 1 from eworks.sanctions s where s.contract_id=new.contract_id) then
      raise exception 'a sanction is required before publishing the tender notice';
    end if;
    if new.published_at is null then new.published_at := now(); end if;
  end if;
  return new;
end; $$;
drop trigger if exists tender_notice_publish_trg on eworks.tender_notices;
create trigger tender_notice_publish_trg before update on eworks.tender_notices
  for each row execute function eworks.tender_notice_publish_guard();

-- Publish: controlled path — permission check, set PUBLISHED (guard fires), float the contract, audit.
create or replace function eworks.publish_tender_notice(p_notice_id uuid)
returns eworks.tender_notices language plpgsql security definer set search_path = eworks, public, extensions, pg_temp as $$
declare v_notice eworks.tender_notices; v_path ltree;
begin
  select ou.path into v_path from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
    join eworks.org_units ou on ou.id=ct.project_id where tn.id=p_notice_id;
  if v_path is null then raise exception 'notice % not found', p_notice_id; end if;
  if not eworks.has_permission('contract.manage', v_path) then raise exception 'not authorized to publish'; end if;
  update eworks.tender_notices set status='PUBLISHED', published_by=eworks.current_user_id(), published_at=now()
    where id=p_notice_id returning * into v_notice;
  update eworks.contracts set status='FLOATED' where id=v_notice.contract_id and status='DRAFT';
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'tender.publish', 'tender_notice', p_notice_id, v_path,
          jsonb_build_object('contract_id', v_notice.contract_id, 'notice_no', v_notice.notice_no));
  return v_notice;
end; $$;

-- Corrigendum guard: only on a PUBLISHED notice (unbypassable).
create or replace function eworks.tender_corrigendum_guard()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from eworks.tender_notices tn where tn.id=new.notice_id and tn.status='PUBLISHED') then
    raise exception 'corrigenda may be issued only on a published notice';
  end if;
  return new;
end; $$;
drop trigger if exists tender_corrigendum_trg on eworks.tender_corrigenda;
create trigger tender_corrigendum_trg before insert on eworks.tender_corrigenda
  for each row execute function eworks.tender_corrigendum_guard();

-- Issue corrigendum: controlled path — permission, auto-number, apply changes, audit.
create or replace function eworks.issue_corrigendum(p_notice_id uuid, p_summary text, p_changes jsonb)
returns eworks.tender_corrigenda language plpgsql security definer set search_path = eworks, public, extensions, pg_temp as $$
declare v_row eworks.tender_corrigenda; v_path ltree; v_next int;
begin
  select ou.path into v_path from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
    join eworks.org_units ou on ou.id=ct.project_id where tn.id=p_notice_id;
  if v_path is null then raise exception 'notice % not found', p_notice_id; end if;
  if not eworks.has_permission('contract.manage', v_path) then raise exception 'not authorized'; end if;
  select coalesce(max(corrigendum_no),0)+1 into v_next from eworks.tender_corrigenda where notice_id=p_notice_id;
  insert into eworks.tender_corrigenda (notice_id, corrigendum_no, summary, changes, issued_by)
  values (p_notice_id, v_next, p_summary, coalesce(p_changes,'{}'::jsonb), eworks.current_user_id())
  returning * into v_row;
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'tender.corrigendum', 'tender_notice', p_notice_id, v_path,
          jsonb_build_object('corrigendum_no', v_next, 'summary', p_summary));
  return v_row;
end; $$;

revoke all on function eworks.record_sanction(uuid,bigint,text) from public;
revoke all on function eworks.publish_tender_notice(uuid) from public;
revoke all on function eworks.issue_corrigendum(uuid,text,jsonb) from public;
grant execute on function eworks.record_sanction(uuid,bigint,text) to eworks_authenticated;
grant execute on function eworks.publish_tender_notice(uuid) to eworks_authenticated;
grant execute on function eworks.issue_corrigendum(uuid,text,jsonb) to eworks_authenticated;

-- Task 1's grants omitted delete on these two tables; test fixtures clean up
-- prior rows directly (outside the security-definer functions) and need it.
grant delete on eworks.tender_notices to eworks_authenticated;
grant delete on eworks.sanctions to eworks_authenticated;
