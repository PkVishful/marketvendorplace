-- Close the gaps found by auditing the platform against the construction
-- testing checklist (construction-testing-checklist.md, 2026-07-15):
--
--   1. SUPERSTRUCTURE was missing the ultrasonic pulse velocity NDT rule
--      (checklist: IS 13311, as needed per member — mirrors rebound hammer).
--   2. ROADWORK was missing the bitumen penetration-grade rule (IS 73, per
--      lot like the other binder tests).
--   3. Rebar tensile & bend is specified by IS 1786 (the HSD rebar standard);
--      the catalog default and the SUPERSTRUCTURE rule said IS 1608 (the
--      generic tensile method), inconsistent with the SUBSTRUCTURE rule.
--   4. Proctor compaction is a borrow/fill-source characterisation test, not
--      a per-layer one (field density covers layers): per the checklist it is
--      "per fill source".

-- 1 + 2: missing national stage rules (org_unit_id NULL), same guarded-insert
-- pattern as 20260711000100_test_catalog_full.sql.
insert into eworks.test_stage_rules (test_id, stage_id, frequency_type, frequency_spec, is_code)
select tc.id, cs.id, v.freq::eworks.frequency_type, v.spec::jsonb, v.is_code
from (values
  ('CONCRETE_NDT_UPV',    'SUPERSTRUCTURE', 'PER_AREA',        '{"unit":"member","samples":1}', 'IS 13311'),
  ('BITUMEN_PENETRATION', 'ROADWORK',       'PER_CONSIGNMENT', '{"unit":"lot","samples":1}',    'IS 73')
) as v(test_code, stage_code, freq, spec, is_code)
join eworks.test_catalog tc       on tc.code = v.test_code
join eworks.construction_stage cs on cs.code = v.stage_code
where not exists (
  select 1 from eworks.test_stage_rules r
   where r.test_id = tc.id and r.stage_id = cs.id and r.org_unit_id is null
);

-- 3: IS 1786 everywhere for rebar tensile & bend.
update eworks.test_catalog
   set default_is_code = 'IS 1786'
 where code = 'STEEL_TENSILE' and default_is_code = 'IS 1608';

update eworks.test_stage_rules r
   set is_code = 'IS 1786'
  from eworks.test_catalog tc
 where r.test_id = tc.id and tc.code = 'STEEL_TENSILE' and r.is_code = 'IS 1608';

-- 4: Proctor is per fill source, not per layer.
update eworks.test_stage_rules r
   set frequency_type = 'PER_CONSIGNMENT',
       frequency_spec = '{"unit":"fill_source","samples":1}'::jsonb
  from eworks.test_catalog tc
 where r.test_id = tc.id
   and tc.code = 'SOIL_COMPACTION_PROCTOR'
   and r.frequency_type = 'PER_LAYER';
