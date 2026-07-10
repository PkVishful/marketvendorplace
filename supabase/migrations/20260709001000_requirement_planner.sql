-- Phase 3a: the requirement planner (master prompt s5, s7 step 1, s13).
--
-- "System generates the testing calendar from *configurable* IS + QAP rules."
--
-- The whole point of s0's "no hardcoded business logic" lands here. The IS 456
-- sampling ladder is a jsonb value in test_stage_rules.frequency_spec. This
-- migration contains the interpreter for that value. It knows about tiers and
-- units; it knows nothing about concrete, cement, or steel. Add a test to the
-- catalog and the planner handles it without a code change.

-- Running the planner twice for the same stage must not silently double every
-- requirement. Without this, a second click of "generate calendar" quietly
-- doubles the number of cubes the project owes.
alter table eworks.project_test_requirements
  add constraint ptr_unique_per_project_test_stage
  unique (project_id, test_id, stage_id);


-- How many samples does `quantity` of `unit` demand under this rule?
--
-- Pure and immutable: given the same rule and quantity it always returns the
-- same count, which is what lets a project's plan be reproduced years later
-- during an audit.
create or replace function eworks.compute_sample_count(
  p_frequency_type eworks.frequency_type,
  p_spec           jsonb,
  p_quantity       numeric
)
returns int
language plpgsql
immutable
parallel safe
as $$
declare
  tier        jsonb;
  last_upto   numeric := 0;
  base        numeric;
  per_add     numeric;
  add_samples numeric;
  extra       numeric;
begin
  if p_frequency_type = 'ONCE' then
    return 1;                      -- soil bearing, mix design, source approval
  end if;

  if p_quantity is null or p_quantity <= 0 then
    return 0;                      -- nothing poured, nothing to test
  end if;

  if p_frequency_type = 'PER_VOLUME' then
    -- Walk the tiers in declared order. IS 456 cl.15.2.2:
    --   1-5 m3 -> 1 sample, 6-15 -> 2, 16-30 -> 3, 31-50 -> 4,
    --   >50    -> 4 + one per additional 50 m3 (or part thereof).
    for tier in select * from jsonb_array_elements(p_spec -> 'tiers') loop
      if p_quantity <= (tier ->> 'upto')::numeric then
        return (tier ->> 'samples')::int;
      end if;
      last_upto := (tier ->> 'upto')::numeric;
    end loop;

    if p_spec ? 'above' then
      base        := (p_spec -> 'above' ->> 'base_samples')::numeric;
      per_add     := (p_spec -> 'above' ->> 'per_additional_m3')::numeric;
      add_samples := (p_spec -> 'above' ->> 'add_samples')::numeric;

      -- ceil(), because "or part thereof": 51 m3 needs the extra sample, not
      -- 0.02 of one. Rounding down here would silently under-test every pour.
      extra := ceil((p_quantity - last_upto) / per_add) * add_samples;
      return (base + extra)::int;
    end if;

    -- Quantity exceeds the top tier and no `above` clause exists. Refusing is
    -- correct: a plan that silently omits tests for a 200 m3 pour is worse
    -- than one that fails to generate.
    raise exception
      'PER_VOLUME rule has no `above` clause but quantity % exceeds the top tier (%)',
      p_quantity, last_upto;
  end if;

  -- Everything else is a straight multiple: `samples` per unit, and quantity
  -- counts the units (consignments, heats, layers, pours, lots).
  -- ceil() again: a partial consignment is still a consignment.
  return (ceil(p_quantity) * (p_spec ->> 'samples')::numeric)::int;
end;
$$;


-- Which rule governs this (test, stage) for this project?
--
-- Precedence: the most specific org override wins. A rule anchored at the
-- project beats one at the district, which beats the state-wide default
-- (org_unit_id IS NULL). This is the per-project QAP hook from s0 -- a stricter
-- local QAP overrides the IS default without duplicating the catalog.
create or replace function eworks.resolve_stage_rule(
  p_project_id uuid,
  p_test_id    uuid,
  p_stage_id   uuid
)
returns eworks.test_stage_rules
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select r.*
    from eworks.test_stage_rules r
    join eworks.org_units proj on proj.id = p_project_id
    left join eworks.org_units ru on ru.id = r.org_unit_id
   where r.test_id = p_test_id
     and r.stage_id = p_stage_id
     and r.is_active
     and (r.org_unit_id is null or proj.path <@ ru.path)
   -- NULL org_unit_id (state-wide) sorts last: nlevel of an override is >= 1.
   order by coalesce(nlevel(ru.path), 0) desc
   limit 1;
$$;


-- Generate the testing calendar for one stage of one project.
--
-- `p_quantities` is keyed by the unit named in each rule's frequency_spec, e.g.
--   {"m3": 120, "consignment": 3, "heat": 2, "pour": 1}
--
-- If a rule needs a unit the caller did not supply, this RAISES rather than
-- skipping. A silently-skipped requirement is an untested pour, and the whole
-- system exists to prevent exactly that.
create or replace function eworks.generate_project_requirements(
  p_project_id uuid,
  p_stage_code text,
  p_quantities jsonb,
  p_required_by date default null
)
returns int
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_stage_id   uuid;
  v_rule       eworks.test_stage_rules;
  v_test       record;
  v_unit       text;
  v_qty        numeric;
  v_count      int;
  v_inserted   int := 0;
  v_missing    text[] := '{}';
begin
  select id into v_stage_id from eworks.construction_stage where code = p_stage_code;
  if v_stage_id is null then
    raise exception 'unknown construction stage %', p_stage_code;
  end if;

  -- First pass: verify every governing rule has the quantity it needs. Doing
  -- this before any insert keeps the function all-or-nothing even if the caller
  -- is not already inside a transaction.
  for v_test in
    select distinct r.test_id from eworks.test_stage_rules r where r.stage_id = v_stage_id and r.is_active
  loop
    v_rule := eworks.resolve_stage_rule(p_project_id, v_test.test_id, v_stage_id);
    continue when v_rule is null;

    if v_rule.frequency_type <> 'ONCE' then
      v_unit := v_rule.frequency_spec ->> 'unit';
      if v_unit is null or not (p_quantities ? v_unit) then
        v_missing := v_missing || coalesce(v_unit, '<no unit in spec>');
      end if;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'stage % needs quantities for units: %',
      p_stage_code, array_to_string(v_missing, ', ');
  end if;

  for v_test in
    select distinct r.test_id from eworks.test_stage_rules r where r.stage_id = v_stage_id and r.is_active
  loop
    v_rule := eworks.resolve_stage_rule(p_project_id, v_test.test_id, v_stage_id);
    continue when v_rule is null;

    if v_rule.frequency_type = 'ONCE' then
      v_qty := 1;
    else
      v_qty := (p_quantities ->> (v_rule.frequency_spec ->> 'unit'))::numeric;
    end if;

    v_count := eworks.compute_sample_count(v_rule.frequency_type, v_rule.frequency_spec, v_qty);
    continue when v_count <= 0;

    insert into eworks.project_test_requirements
      (project_id, test_id, stage_id, source_rule_id, frequency_type,
       -- Snapshot, not a reference. A QAP revised next year must not
       -- retroactively change what this project was required to test.
       acceptance_criteria, planned_count, required_by)
    values
      (p_project_id, v_test.test_id, v_stage_id, v_rule.id, v_rule.frequency_type,
       v_rule.acceptance_criteria, v_count, p_required_by);

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

comment on function eworks.compute_sample_count(eworks.frequency_type, jsonb, numeric) is
  'Interprets a frequency_spec. Knows about tiers and units; knows nothing '
  'about concrete, cement, or steel. Adding a test needs no code change.';
