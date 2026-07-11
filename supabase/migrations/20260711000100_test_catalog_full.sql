-- Full construction-testing catalog & stage rules (seed data).
--
-- Turns the QA testing catalog document into configurable rows for the existing
-- requirement-generation engine (test_catalog + test_stage_rules). NO schema or
-- engine changes. Additive and idempotent:
--   * test_catalog        -> on conflict (code) do nothing
--   * test_stage_rules    -> guarded by `not exists` (org_unit_id is null makes
--                            the UNIQUE(test,stage,org) index NULL-distinct, so
--                            on-conflict cannot dedupe national rules).
--
-- Tests are SPLIT to individual measurements (per product decision). The 12
-- pre-seeded bundled tests (CEMENT_PHYSICAL, AGGREGATE_GRADING, STEEL_TENSILE,
-- SOIL_COMPACTION_PROCTOR, ...) are LEFT AS-IS; splitting them would orphan
-- their existing rules/pricing, so that is a separate follow-up.
--
-- Frequencies and IS codes are INDICATIVE (common Indian practice) and are data,
-- not law: per-project/per-org overrides go through resolve_stage_rule, and the
-- authoritative values come from the current IS codes + the project QAP. A `—`
-- IS code in the source document is stored as NULL, to be set from the QAP.
--
-- frequency_spec must satisfy compute_sample_count():
--   ONCE        -> {}                                     (always 1)
--   PER_VOLUME  -> {unit, tiers:[{upto,samples}], above}  (tiered; raises past top tier w/o `above`)
--   others      -> {unit, samples}                        (ceil(qty) * samples); `unit` is a Planner quantity key

-- ---------------------------------------------------------------------------
-- 1. Catalog entries (new tests only; existing 12 kept)
-- ---------------------------------------------------------------------------
insert into eworks.test_catalog (code, name, domain, default_is_code, requires_nabl, typical_tat_days) values
  -- SOIL / GEOTECH
  ('SOIL_SPT',                'Standard penetration test (bore log)',        'SOIL_GEOTECH', 'IS 2131',   true,  7),
  ('SOIL_GRAIN_SIZE',         'Grain size / sieve analysis',                 'SOIL_GEOTECH', 'IS 2720-4', true,  5),
  ('SOIL_ATTERBERG',          'Atterberg limits (LL/PL/PI)',                 'SOIL_GEOTECH', 'IS 2720-5', true,  5),
  ('SOIL_SULPHATE',           'Soil sulphate content',                       'SOIL_GEOTECH', 'IS 2720-27',true,  5),
  ('SOIL_CHLORIDE',           'Soil chloride content',                       'SOIL_GEOTECH', 'IS 2720-27',true,  5),
  ('SOIL_PH',                 'Soil pH',                                     'SOIL_GEOTECH', 'IS 2720-26',true,  3),
  ('SOIL_CBR',                'California Bearing Ratio',                     'SOIL_GEOTECH', 'IS 2720-16',true,  7),
  ('SOIL_FIELD_DENSITY',      'Field density (core cutter / sand replacement)','SOIL_GEOTECH','IS 2720-28',true, 2),
  ('PILE_INTEGRITY',          'Pile integrity test (PIT)',                   'SOIL_GEOTECH', 'IS 2911',   true,  3),
  ('PILE_LOAD',               'Pile load test',                              'SOIL_GEOTECH', 'IS 2911',   true, 14),
  ('BENTONITE_DENSITY',       'Bentonite slurry density',                    'SOIL_GEOTECH', null,        false, 1),
  ('BENTONITE_VISCOSITY',     'Bentonite Marsh-cone viscosity',              'SOIL_GEOTECH', null,        false, 1),
  ('BENTONITE_PH',            'Bentonite slurry pH',                         'SOIL_GEOTECH', null,        false, 1),
  ('BENTONITE_SAND_CONTENT',  'Bentonite sand content',                      'SOIL_GEOTECH', null,        false, 1),
  ('ANTITERMITE_VERIFY',      'Anti-termite treatment verification',         'SOIL_GEOTECH', 'IS 6313',   false, 1),

  -- CONCRETE
  ('CONCRETE_CORE',           'Concrete core extraction & test',             'CONCRETE', 'IS 516',       true, 10),
  ('CONCRETE_NDT_REBOUND',    'Rebound hammer (NDT)',                        'CONCRETE', 'IS 13311-2',   true,  2),
  ('CONCRETE_RCPT',           'Rapid chloride permeability (RCPT)',          'CONCRETE', 'ASTM C1202',   true,  7),

  -- AGGREGATE (grading bundle already seeded)
  ('AGGREGATE_ABRASION',      'Los Angeles abrasion / impact / crushing',    'AGGREGATE', 'IS 2386-4',   true,  5),
  ('AGGREGATE_FLAKINESS',     'Flakiness & elongation index',                'AGGREGATE', 'IS 2386-1',   true,  3),
  ('AGGREGATE_SILT_CONTENT',  'Silt / deleterious content',                  'AGGREGATE', 'IS 2386-2',   true,  3),

  -- STEEL / WELDING & NDT (tensile bundle already seeded)
  ('STEEL_CHEMICAL',          'Rebar chemical composition (per heat)',       'STEEL_REBAR', 'IS 1786',   true,  7),
  ('STRUCTURAL_STEEL_SECTION','Structural steel section test',               'STEEL_REBAR', 'IS 2062',   true,  7),
  ('WELD_UT',                 'Weld ultrasonic testing (UT)',                'STEEL_REBAR', 'IS 3664',   true,  3),
  ('WELD_RT',                 'Weld radiographic testing (RT)',              'STEEL_REBAR', 'IS 1182',   true,  3),
  ('WELD_DPT',                'Weld dye penetrant testing (DPT)',            'STEEL_REBAR', null,        true,  2),
  ('WELD_MPT',                'Weld magnetic particle testing (MPT)',        'STEEL_REBAR', null,        true,  2),
  ('WELD_VISUAL',             'Visual weld inspection',                      'STEEL_REBAR', null,        false, 1),

  -- MASONRY (brick compressive bundle already seeded)
  ('BRICK_WATER_ABSORPTION',  'Brick water absorption',                      'MASONRY', 'IS 3495',       true,  3),
  ('BRICK_EFFLORESCENCE',     'Brick efflorescence',                         'MASONRY', 'IS 3495',       false, 2),
  ('AAC_STRENGTH',            'AAC / concrete block compressive strength',   'MASONRY', 'IS 2185',       true,  5),
  ('AAC_DENSITY',             'AAC / concrete block dry density',            'MASONRY', 'IS 2185',       true,  3),

  -- BITUMEN / ROAD (penetration already seeded)
  ('BITUMEN_SOFTENING',       'Bitumen softening point',                     'BITUMEN_ROAD', 'IS 1205',  true,  3),
  ('BITUMEN_DUCTILITY',       'Bitumen ductility',                           'BITUMEN_ROAD', 'IS 1208',  true,  3),
  ('BITUMEN_VISCOSITY',       'Bitumen viscosity',                           'BITUMEN_ROAD', 'IS 1206',  true,  3),
  ('BITUMEN_MARSHALL',        'Bituminous mix Marshall stability',           'BITUMEN_ROAD', 'MoRTH',    true,  5),
  ('BITUMEN_EXTRACTION',      'Bitumen content extraction',                  'BITUMEN_ROAD', 'MoRTH',    true,  3),
  ('ROAD_LAYER_DENSITY',      'Field density (bituminous / GSB / WMM)',      'BITUMEN_ROAD', 'MoRTH',    true,  2),

  -- WATERPROOFING / FINISHES
  ('WATERPROOF_PONDING',      'Ponding / flood test',                        'WATERPROOFING_FINISHES', null,       false, 3),
  ('PLASTER_THICKNESS',       'Plaster thickness check',                     'WATERPROOFING_FINISHES', null,       false, 1),
  ('PLASTER_ADHESION',        'Plaster adhesion',                            'WATERPROOFING_FINISHES', null,       false, 2),
  ('TILE_ADHESION',           'Tile pull-off / adhesion',                    'WATERPROOFING_FINISHES', 'IS 15622', true,  3),
  ('TILE_WATER_ABSORPTION',   'Tile water absorption',                       'WATERPROOFING_FINISHES', 'IS 13630', true,  3),
  ('PAINT_DFT',               'Paint dry film thickness (DFT)',              'WATERPROOFING_FINISHES', null,       false, 1),

  -- ELECTRICAL
  ('ELEC_INSULATION_RESISTANCE','Insulation resistance (megger)',            'ELECTRICAL', 'IS 732',     false, 1),
  ('ELEC_EARTH_RESISTANCE',   'Earth resistance / earth pit',                'ELECTRICAL', 'IS 3043',    false, 1),
  ('ELEC_CONTINUITY',         'Continuity test',                             'ELECTRICAL', 'IS 732',     false, 1),
  ('ELEC_POLARITY',           'Polarity test',                               'ELECTRICAL', 'IS 732',     false, 1),
  ('ELEC_HV',                 'High-voltage / dielectric test',              'ELECTRICAL', 'IS 732',     false, 1),
  ('ELEC_RCD_TRIP',           'RCD / ELCB trip test',                        'ELECTRICAL', 'IS 732',     false, 1),

  -- PLUMBING / FIRE / HVAC
  ('PLUMB_HYDROSTATIC',       'Plumbing hydrostatic pressure test',          'PLUMBING_FIRE_HVAC', null, false, 1),
  ('PLUMB_DRAINAGE',          'Drainage / sewer leak test',                  'PLUMBING_FIRE_HVAC', null, false, 1),
  ('PLUMB_SMOKE',             'Drainage smoke test',                         'PLUMBING_FIRE_HVAC', null, false, 1),
  ('FIRE_HYDRANT',            'Fire hydrant test',                           'PLUMBING_FIRE_HVAC', null, false, 1),
  ('FIRE_SPRINKLER',          'Fire sprinkler test',                         'PLUMBING_FIRE_HVAC', null, false, 1),
  ('FIRE_ALARM',              'Fire alarm test',                             'PLUMBING_FIRE_HVAC', null, false, 1),
  ('HVAC_DUCT_LEAKAGE',       'HVAC duct leakage test',                      'PLUMBING_FIRE_HVAC', null, false, 1),
  ('HVAC_AIR_BALANCING',      'HVAC air balancing (TAB)',                    'PLUMBING_FIRE_HVAC', null, false, 2)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Stage rules (national / org_unit_id NULL). Joined by code; guarded so the
--    6 pre-seeded rules and re-runs never duplicate.
-- ---------------------------------------------------------------------------
insert into eworks.test_stage_rules (test_id, stage_id, frequency_type, frequency_spec, is_code)
select tc.id, cs.id, v.freq::eworks.frequency_type, v.spec::jsonb, v.is_code
from (values
  -- SITE_INVESTIGATION
  ('SOIL_SPT',              'SITE_INVESTIGATION', 'PER_LOT',   '{"unit":"borehole","samples":1}', 'IS 2131'),
  ('SOIL_GRAIN_SIZE',       'SITE_INVESTIGATION', 'PER_LOT',   '{"unit":"stratum","samples":1}',  'IS 2720-4'),
  ('SOIL_ATTERBERG',        'SITE_INVESTIGATION', 'PER_LOT',   '{"unit":"stratum","samples":1}',  'IS 2720-5'),
  ('SOIL_SULPHATE',         'SITE_INVESTIGATION', 'ONCE',      '{}',                              'IS 2720-27'),
  ('SOIL_CHLORIDE',         'SITE_INVESTIGATION', 'ONCE',      '{}',                              'IS 2720-27'),
  ('SOIL_PH',               'SITE_INVESTIGATION', 'ONCE',      '{}',                              'IS 2720-26'),
  ('SOIL_CBR',              'SITE_INVESTIGATION', 'PER_LOT',   '{"unit":"stretch","samples":1}',  'IS 2720-16'),

  -- EARTHWORK
  ('SOIL_FIELD_DENSITY',    'EARTHWORK',          'PER_LAYER', '{"unit":"layer","samples":1,"area_per_sample_m2":500}', 'IS 2720-28'),

  -- FOUNDATION (piling, PCC, source materials)
  ('PILE_INTEGRITY',        'FOUNDATION',         'PER_LOT',   '{"unit":"pile","samples":1}',         'IS 2911'),
  ('PILE_LOAD',             'FOUNDATION',         'PER_LOT',   '{"unit":"proof_pile","samples":1}',   'IS 2911'),
  ('BENTONITE_DENSITY',     'FOUNDATION',         'PER_LOT',   '{"unit":"pile","samples":1}',         null),
  ('BENTONITE_VISCOSITY',   'FOUNDATION',         'PER_LOT',   '{"unit":"pile","samples":1}',         null),
  ('BENTONITE_PH',          'FOUNDATION',         'PER_LOT',   '{"unit":"pile","samples":1}',         null),
  ('BENTONITE_SAND_CONTENT','FOUNDATION',         'PER_LOT',   '{"unit":"pile","samples":1}',         null),
  ('ANTITERMITE_VERIFY',    'FOUNDATION',         'ONCE',      '{}',                                  'IS 6313'),
  ('CONCRETE_SLUMP',        'FOUNDATION',         'PER_STAGE', '{"unit":"pour","samples":1}',         'IS 1199'),
  ('CONCRETE_CUBE_STRENGTH','FOUNDATION',         'PER_VOLUME','{"unit":"m3","tiers":[{"upto":5,"samples":1},{"upto":15,"samples":2},{"upto":30,"samples":3},{"upto":50,"samples":4}],"above":{"base_samples":4,"per_additional_m3":50,"add_samples":1},"test_ages_days":[7,28],"specimens_per_sample":3}', 'IS 516'),
  ('CEMENT_PHYSICAL',       'FOUNDATION',         'PER_CONSIGNMENT','{"unit":"consignment","samples":1}', 'IS 4031'),
  ('AGGREGATE_GRADING',     'FOUNDATION',         'PER_CONSIGNMENT','{"unit":"source","samples":1}',   'IS 2386'),
  ('AGGREGATE_SILT_CONTENT','FOUNDATION',         'PER_CONSIGNMENT','{"unit":"source","samples":1}',   'IS 2386-2'),

  -- SUBSTRUCTURE (footing / plinth)
  ('CONCRETE_SLUMP',        'SUBSTRUCTURE',       'PER_STAGE', '{"unit":"pour","samples":1}',         'IS 1199'),
  ('CONCRETE_CUBE_STRENGTH','SUBSTRUCTURE',       'PER_VOLUME','{"unit":"m3","tiers":[{"upto":5,"samples":1},{"upto":15,"samples":2},{"upto":30,"samples":3},{"upto":50,"samples":4}],"above":{"base_samples":4,"per_additional_m3":50,"add_samples":1},"test_ages_days":[7,28],"specimens_per_sample":3}', 'IS 516'),
  ('STEEL_TENSILE',         'SUBSTRUCTURE',       'PER_HEAT',  '{"unit":"heat","samples":1,"max_tonnes_per_heat":40}', 'IS 1786'),
  ('STEEL_CHEMICAL',        'SUBSTRUCTURE',       'PER_HEAT',  '{"unit":"heat","samples":1}',         'IS 1786'),
  ('BRICK_COMPRESSIVE',     'SUBSTRUCTURE',       'PER_LOT',   '{"unit":"lot","samples":1}',          'IS 3495'),

  -- SUPERSTRUCTURE (columns / beams / slabs / roof)
  ('CONCRETE_CORE',         'SUPERSTRUCTURE',     'PER_LOT',   '{"unit":"failed_location","samples":1}', 'IS 516'),
  ('CONCRETE_NDT_REBOUND',  'SUPERSTRUCTURE',     'PER_AREA',  '{"unit":"member","samples":1}',       'IS 13311-2'),
  ('CONCRETE_RCPT',         'SUPERSTRUCTURE',     'ONCE',      '{}',                                  'ASTM C1202'),
  ('STEEL_CHEMICAL',        'SUPERSTRUCTURE',     'PER_HEAT',  '{"unit":"heat","samples":1}',         'IS 1786'),
  ('STRUCTURAL_STEEL_SECTION','SUPERSTRUCTURE',   'PER_HEAT',  '{"unit":"heat","samples":1}',         'IS 2062'),
  ('WELD_UT',               'SUPERSTRUCTURE',     'PER_LOT',   '{"unit":"weld","samples":1}',         'IS 3664'),
  ('WELD_RT',               'SUPERSTRUCTURE',     'PER_LOT',   '{"unit":"weld","samples":1}',         'IS 1182'),
  ('WELD_DPT',              'SUPERSTRUCTURE',     'PER_LOT',   '{"unit":"weld","samples":1}',         null),
  ('WELD_MPT',              'SUPERSTRUCTURE',     'PER_LOT',   '{"unit":"weld","samples":1}',         null),
  ('WELD_VISUAL',           'SUPERSTRUCTURE',     'PER_LOT',   '{"unit":"weld","samples":1}',         null),

  -- MASONRY
  ('BRICK_WATER_ABSORPTION','MASONRY',            'PER_LOT',   '{"unit":"lot","samples":1}',          'IS 3495'),
  ('BRICK_EFFLORESCENCE',   'MASONRY',            'PER_LOT',   '{"unit":"lot","samples":1}',          'IS 3495'),
  ('AAC_STRENGTH',          'MASONRY',            'PER_LOT',   '{"unit":"lot","samples":1}',          'IS 2185'),
  ('AAC_DENSITY',           'MASONRY',            'PER_LOT',   '{"unit":"lot","samples":1}',          'IS 2185'),

  -- ROADWORK
  ('AGGREGATE_ABRASION',    'ROADWORK',           'PER_CONSIGNMENT','{"unit":"source","samples":1}',  'IS 2386-4'),
  ('AGGREGATE_FLAKINESS',   'ROADWORK',           'PER_CONSIGNMENT','{"unit":"source","samples":1}',  'IS 2386-1'),
  ('BITUMEN_SOFTENING',     'ROADWORK',           'PER_CONSIGNMENT','{"unit":"lot","samples":1}',     'IS 1205'),
  ('BITUMEN_DUCTILITY',     'ROADWORK',           'PER_CONSIGNMENT','{"unit":"lot","samples":1}',     'IS 1208'),
  ('BITUMEN_VISCOSITY',     'ROADWORK',           'PER_CONSIGNMENT','{"unit":"lot","samples":1}',     'IS 1206'),
  ('BITUMEN_MARSHALL',      'ROADWORK',           'ONCE',      '{}',                                  'MoRTH'),
  ('BITUMEN_EXTRACTION',    'ROADWORK',           'PER_STAGE', '{"unit":"laying_day","samples":1}',   'MoRTH'),
  ('ROAD_LAYER_DENSITY',    'ROADWORK',           'PER_LAYER', '{"unit":"layer","samples":1}',        'MoRTH'),

  -- FINISHES
  ('WATERPROOF_PONDING',    'FINISHES',           'PER_AREA',  '{"unit":"treated_area","samples":1}', null),
  ('PLASTER_THICKNESS',     'FINISHES',           'PER_AREA',  '{"unit":"area","samples":1}',         null),
  ('PLASTER_ADHESION',      'FINISHES',           'PER_AREA',  '{"unit":"area","samples":1}',         null),
  ('TILE_ADHESION',         'FINISHES',           'PER_AREA',  '{"unit":"area","samples":1}',         'IS 15622'),
  ('TILE_WATER_ABSORPTION', 'FINISHES',           'PER_LOT',   '{"unit":"lot","samples":1}',          'IS 13630'),
  ('PAINT_DFT',             'FINISHES',           'PER_AREA',  '{"unit":"area","samples":1}',         null),

  -- SERVICES (electrical / plumbing / fire / HVAC)
  ('ELEC_INSULATION_RESISTANCE','SERVICES',       'PER_LOT',   '{"unit":"circuit","samples":1}',      'IS 732'),
  ('ELEC_EARTH_RESISTANCE', 'SERVICES',           'PER_LOT',   '{"unit":"earth_pit","samples":1}',    'IS 3043'),
  ('ELEC_CONTINUITY',       'SERVICES',           'PER_LOT',   '{"unit":"circuit","samples":1}',      'IS 732'),
  ('ELEC_POLARITY',         'SERVICES',           'PER_LOT',   '{"unit":"circuit","samples":1}',      'IS 732'),
  ('ELEC_HV',               'SERVICES',           'PER_LOT',   '{"unit":"board","samples":1}',        'IS 732'),
  ('ELEC_RCD_TRIP',         'SERVICES',           'PER_LOT',   '{"unit":"board","samples":1}',        'IS 732'),
  ('PLUMB_HYDROSTATIC',     'SERVICES',           'PER_LOT',   '{"unit":"zone","samples":1}',         null),
  ('PLUMB_DRAINAGE',        'SERVICES',           'PER_LOT',   '{"unit":"line","samples":1}',         null),
  ('PLUMB_SMOKE',           'SERVICES',           'PER_LOT',   '{"unit":"line","samples":1}',         null),
  ('FIRE_HYDRANT',          'SERVICES',           'PER_LOT',   '{"unit":"system","samples":1}',       null),
  ('FIRE_SPRINKLER',        'SERVICES',           'PER_LOT',   '{"unit":"system","samples":1}',       null),
  ('FIRE_ALARM',            'SERVICES',           'PER_LOT',   '{"unit":"system","samples":1}',       null),
  ('HVAC_DUCT_LEAKAGE',     'SERVICES',           'PER_LOT',   '{"unit":"system","samples":1}',       null),
  ('HVAC_AIR_BALANCING',    'SERVICES',           'PER_LOT',   '{"unit":"system","samples":1}',       null)
) as v(test_code, stage_code, freq, spec, is_code)
join eworks.test_catalog tc       on tc.code = v.test_code
join eworks.construction_stage cs on cs.code = v.stage_code
where not exists (
  select 1 from eworks.test_stage_rules r
   where r.test_id = tc.id and r.stage_id = cs.id and r.org_unit_id is null
);
