-- Test catalog, stage rules, and per-project requirements (master prompt s5).
--
-- The load-bearing constraint from s0: "No hardcoded business logic. Test
-- frequencies, acceptance criteria, and workflow rules are configurable data
-- ... never baked into code."
--
-- So: how often a test fires is a row, not an `if`. What counts as a pass is a
-- row, not an `if`. IS 456's sampling ladder (1 sample for 1-5 m3, 2 for
-- 6-15 m3, ...) lives in `frequency_spec` as data. When the department revises
-- a QAP, they edit rows -- nobody redeploys.

create type eworks.test_domain as enum (
  'SOIL_GEOTECH', 'CONCRETE', 'CEMENT', 'AGGREGATE', 'WATER',
  'STEEL_REBAR', 'MASONRY', 'BITUMEN_ROAD', 'WATERPROOFING_FINISHES',
  'ELECTRICAL', 'PLUMBING_FIRE_HVAC'
);

-- s5 layer 2. How often a test fires.
create type eworks.frequency_type as enum (
  'ONCE',              -- soil bearing capacity, mix design, source approval
  'PER_STAGE',
  'PER_LOT',
  'PER_VOLUME',        -- concrete cubes per m3 poured
  'PER_AREA',
  'PER_LAYER',         -- embankment compaction per lift
  'PER_HEAT',          -- steel per heat number
  'PER_CONSIGNMENT'    -- cement per delivery
);


-- s5 layer 1 -------------------------------------------------------------
create table eworks.construction_stage (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique check (code ~ '^[A-Z0-9_]+$'),
  name      text not null,
  sequence  int  not null,
  constraint construction_stage_sequence_unique unique (sequence)
);

create table eworks.test_catalog (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9_]+$'),
  name           text not null,
  domain         eworks.test_domain not null,
  default_is_code text,
  -- s14: "NABL-eligibility-per-test". A vendor without live NABL accreditation
  -- covering this test must be filtered out at bid time, not at award time.
  requires_nabl  boolean not null default false,
  -- Typical turnaround, used to compute required_by on a floated order.
  typical_tat_days int not null default 1 check (typical_tat_days >= 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create index test_catalog_domain_idx on eworks.test_catalog (domain) where is_active;


-- s5 layer 2 -------------------------------------------------------------
create table eworks.test_stage_rules (
  id             uuid primary key default gen_random_uuid(),
  test_id        uuid not null references eworks.test_catalog(id) on delete cascade,
  stage_id       uuid not null references eworks.construction_stage(id) on delete cascade,

  frequency_type eworks.frequency_type not null,

  -- Interpretation depends on frequency_type. Deliberately a jsonb blob rather
  -- than a pile of nullable columns, because each frequency_type carries a
  -- different shape:
  --   ONCE            -> {}
  --   PER_VOLUME      -> {"unit":"m3","tiers":[{"upto":5,"samples":1}, ...],
  --                       "specimens_per_sample":3}
  --   PER_CONSIGNMENT -> {"unit":"consignment","samples":1}
  --   PER_HEAT        -> {"unit":"heat","samples":1,"max_tonnes_per_heat":40}
  -- Validated by eworks.validate_frequency_spec() below, so a malformed rule
  -- cannot reach the planner.
  frequency_spec jsonb not null default '{}'::jsonb,

  -- s5: "reconcile with IS codes + project QAP". The rule may override the
  -- catalog's default IS code.
  is_code        text,

  -- Pass/fail is data. e.g. for cube strength at 28 days:
  --   {"metric":"strength_n_per_mm2","min":25,
  --    "source":"IS 456 cl.16 / project QAP"}
  -- The pass/fail engine reads this; it contains no test-specific branches.
  acceptance_criteria jsonb not null default '{}'::jsonb,

  -- A NULL org_unit_id means the state-wide default. A non-NULL value lets a
  -- district or a single project override the rule -- this is the "per-project
  -- QAP" hook from s0, without duplicating the catalog.
  org_unit_id    uuid references eworks.org_units(id) on delete cascade,

  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),

  constraint test_stage_rules_scope_unique unique (test_id, stage_id, org_unit_id)
);

create index test_stage_rules_lookup_idx
  on eworks.test_stage_rules (stage_id, test_id) where is_active;

-- Rejects a frequency_spec whose shape does not match its frequency_type.
-- Without this, a typo in a QAP row surfaces months later as a project that
-- silently scheduled zero cube tests.
create or replace function eworks.validate_frequency_spec()
returns trigger
language plpgsql
as $$
declare
  tiers jsonb;
begin
  case new.frequency_type
    when 'ONCE' then
      null;

    when 'PER_VOLUME' then
      tiers := new.frequency_spec -> 'tiers';
      if jsonb_typeof(tiers) is distinct from 'array' or jsonb_array_length(tiers) = 0 then
        raise exception 'PER_VOLUME rule requires a non-empty frequency_spec.tiers array';
      end if;
      if new.frequency_spec ->> 'unit' is null then
        raise exception 'PER_VOLUME rule requires frequency_spec.unit';
      end if;

    else
      -- Every non-ONCE, non-tiered rule must at least say how many samples.
      if (new.frequency_spec ->> 'samples') is null then
        raise exception '% rule requires frequency_spec.samples', new.frequency_type;
      end if;
  end case;

  return new;
end;
$$;

create trigger test_stage_rules_validate_trg
  before insert or update on eworks.test_stage_rules
  for each row execute function eworks.validate_frequency_spec();


-- s5 layer 3 -------------------------------------------------------------
-- Instances generated for a project from its stages. These become orders.
create table eworks.project_test_requirements (
  id             uuid primary key default gen_random_uuid(),
  -- A PROJECT is itself an org_unit (s4: the hierarchy bottoms out at
  -- Project), which is what lets one RLS predicate cover this table too.
  project_id     uuid not null references eworks.org_units(id) on delete cascade,
  test_id        uuid not null references eworks.test_catalog(id) on delete restrict,
  stage_id       uuid not null references eworks.construction_stage(id) on delete restrict,
  source_rule_id uuid references eworks.test_stage_rules(id) on delete set null,

  -- Snapshot of the rule at generation time. A later QAP revision must not
  -- retroactively change what a completed project was required to test --
  -- that would rewrite history in an audited system.
  frequency_type      eworks.frequency_type not null,
  acceptance_criteria jsonb not null,

  planned_count  int not null check (planned_count > 0),
  completed_count int not null default 0 check (completed_count >= 0),

  status         text not null default 'PLANNED'
                   check (status in ('PLANNED','FLOATED','IN_PROGRESS','COMPLETE','WAIVED')),
  required_by    date,
  created_at     timestamptz not null default now(),

  constraint ptr_completed_not_over check (completed_count <= planned_count)
);

create index ptr_project_status_idx
  on eworks.project_test_requirements (project_id, status);

-- Enforce that project_id really points at a PROJECT-level unit. A FK alone
-- cannot express this, and without it a requirement could be attached to a
-- whole District.
create or replace function eworks.ptr_project_level_check()
returns trigger
language plpgsql
as $$
declare
  lvl eworks.org_level;
begin
  select level into lvl from eworks.org_units where id = new.project_id;
  if lvl is distinct from 'PROJECT' then
    raise exception 'project_test_requirements.project_id must reference a PROJECT org_unit, got %', lvl;
  end if;
  return new;
end;
$$;

create trigger ptr_project_level_trg
  before insert or update of project_id on eworks.project_test_requirements
  for each row execute function eworks.ptr_project_level_check();


-- ---------------------------------------------------------------------------
-- RLS for catalog tables
-- ---------------------------------------------------------------------------
-- The catalog is reference data: readable by every authenticated user, mutable
-- only by holders of `catalog.manage` (Head admin, s3).
alter table eworks.construction_stage enable row level security;
alter table eworks.test_catalog        enable row level security;
alter table eworks.test_stage_rules    enable row level security;
alter table eworks.project_test_requirements enable row level security;

grant select on eworks.construction_stage to eworks_authenticated;
grant select, insert, update, delete
   on eworks.test_catalog, eworks.test_stage_rules, eworks.project_test_requirements
   to eworks_authenticated;

create policy stage_read on eworks.construction_stage
  for select to eworks_authenticated using (eworks.current_user_id() is not null);

create policy catalog_read on eworks.test_catalog
  for select to eworks_authenticated using (eworks.current_user_id() is not null);

create policy catalog_write on eworks.test_catalog
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('catalog.manage'))
  with check (eworks.has_permission_anywhere('catalog.manage'));

-- A state-wide rule (org_unit_id IS NULL) needs `catalog.manage`. A scoped
-- override needs `catalog.manage` at a unit dominating the override's unit --
-- so a District Officer can tighten a rule for their district, and cannot
-- loosen one for another district.
create policy rules_read on eworks.test_stage_rules
  for select to eworks_authenticated
  using (
    org_unit_id is null
    or exists (select 1 from eworks.org_units ou
                where ou.id = test_stage_rules.org_unit_id
                  and eworks.in_scope(ou.path))
  );

create policy rules_write on eworks.test_stage_rules
  for all to eworks_authenticated
  using (
    case when org_unit_id is null
         then eworks.has_permission_anywhere('catalog.manage')
         else exists (select 1 from eworks.org_units ou
                       where ou.id = test_stage_rules.org_unit_id
                         and eworks.has_permission('catalog.manage', ou.path))
    end
  )
  with check (
    case when org_unit_id is null
         then eworks.has_permission_anywhere('catalog.manage')
         else exists (select 1 from eworks.org_units ou
                       where ou.id = test_stage_rules.org_unit_id
                         and eworks.has_permission('catalog.manage', ou.path))
    end
  );

-- `order.read`, not bare in_scope(). A lab vendor holds a role anchored in the
-- district, so in_scope() is true for them, and the planned test calendar is
-- the RFQ pipeline before it is floated. LAB_VENDOR does not hold order.read.
create policy ptr_read on eworks.project_test_requirements
  for select to eworks_authenticated
  using (
    exists (select 1 from eworks.org_units ou
             where ou.id = project_test_requirements.project_id
               and eworks.has_permission('order.read', ou.path))
  );
