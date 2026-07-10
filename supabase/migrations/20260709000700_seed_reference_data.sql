-- Reference data: roles, permissions, construction stages, and the seeded test
-- catalog (master prompt s3, s5, s13 Phase 0).
--
-- IS-code references below are INDICATIVE, exactly as s5 states: "reconcile
-- with IS codes + project QAP". They are starting values for the department to
-- ratify, not a legal citation. Every one of them is editable at runtime by a
-- Head admin holding `catalog.manage` -- which is the entire point of s0's
-- "no hardcoded business logic".

-- Roles (s3, ground -> top) -------------------------------------------------
insert into eworks.roles (code, name, description) values
  ('FIELD_TECHNICIAN', 'Field technician (lab)', 'Assigned job scope. Geo-fenced check-in, QR bind, sample collection.'),
  ('LAB_VENDOR',       'Lab vendor owner/manager', 'Own lab. KYC, capabilities, pricing, bids, jobs, earnings.'),
  ('SITE_ENGINEER',    'Site engineer (JE/AE)', 'Section/subdivision. Raise test request, float order, verify certificate.'),
  ('EXECUTIVE_ENGINEER','Executive engineer (EE)', 'Division. Review/award higher-value orders, oversight.'),
  ('DISTRICT_OFFICER', 'Superintending engineer / district officer', 'Circle/district. Verify and approve vendors.'),
  ('AUDITOR',          'Auditor', 'Read-only across assigned scope plus full audit log.'),
  ('HEAD_ADMIN',       'Head admin (department)', 'State. Districts, users, roles, test catalog, KYC, settings.'),
  ('AI_SERVICE',       'AI service account', 'Non-interactive fraud and verification checks.')
on conflict (code) do nothing;

-- Permissions ---------------------------------------------------------------
insert into eworks.permissions (code, description) values
  ('org.manage',      'Create and modify org units'),
  ('user.read',       'View users within scope'),
  ('user.manage',     'Grant and revoke roles within scope'),
  ('catalog.manage',  'Manage test catalog and stage rules'),
  -- Distinct from org scope. Merely holding a role inside a district must not
  -- let you read that district's vendors -- a lab vendor holds a role there
  -- too, and would otherwise read every competitor's row.
  ('vendor.read',     'View vendor records within scope'),
  ('vendor.approve',  'Verify and approve vendor KYC'),
  -- Like vendor.read, this is a permission rather than org scope. A lab holds a
  -- LAB_VENDOR role anchored in a district; gating order reads on in_scope()
  -- alone would show every lab the district's entire RFQ pipeline, including
  -- DRAFT orders that have not been floated yet.
  ('order.read',      'View test orders and project test requirements within scope'),
  ('order.float',     'Float a sealed test order'),
  ('order.award',     'Award an order after bid close'),
  ('bid.submit',      'Submit a sealed bid'),
  ('result.enter',    'Enter test results and upload certificate'),
  ('result.verify',   'Verify a certificate and sign off'),
  ('audit.read',      'Read audit log within scope'),
  ('audit.read_all',  'Read the entire audit log, including system events')
on conflict (code) do nothing;

insert into eworks.role_permissions (role_code, permission_code) values
  ('HEAD_ADMIN','org.manage'),      ('HEAD_ADMIN','user.read'),
  ('HEAD_ADMIN','user.manage'),     ('HEAD_ADMIN','catalog.manage'),
  ('HEAD_ADMIN','vendor.approve'),  ('HEAD_ADMIN','audit.read_all'),
  ('HEAD_ADMIN','vendor.read'),     ('HEAD_ADMIN','order.read'),

  ('DISTRICT_OFFICER','vendor.approve'), ('DISTRICT_OFFICER','user.read'),
  ('DISTRICT_OFFICER','audit.read'),     ('DISTRICT_OFFICER','order.award'),
  ('DISTRICT_OFFICER','catalog.manage'), ('DISTRICT_OFFICER','vendor.read'),
  ('DISTRICT_OFFICER','order.read'),

  ('EXECUTIVE_ENGINEER','order.award'),  ('EXECUTIVE_ENGINEER','user.read'),
  ('EXECUTIVE_ENGINEER','audit.read'),   ('EXECUTIVE_ENGINEER','vendor.read'),
  ('EXECUTIVE_ENGINEER','order.read'),

  ('SITE_ENGINEER','order.float'),       ('SITE_ENGINEER','result.verify'),
  ('SITE_ENGINEER','vendor.read'),       ('SITE_ENGINEER','order.read'),

  -- LAB_VENDOR deliberately has NO vendor.read. A lab reads its own row
  -- through the owner_user_id branch of the policy, never through org scope.
  ('LAB_VENDOR','bid.submit'),           ('LAB_VENDOR','result.enter'),

  ('FIELD_TECHNICIAN','result.enter'),

  -- s3: "Read-only across records + full audit log."
  ('AUDITOR','audit.read'),              ('AUDITOR','audit.read_all'),
  ('AUDITOR','user.read'),               ('AUDITOR','vendor.read'),
  ('AUDITOR','order.read')
on conflict do nothing;

-- Construction stages -------------------------------------------------------
insert into eworks.construction_stage (code, name, sequence) values
  ('SITE_INVESTIGATION', 'Site investigation',      10),
  ('EARTHWORK',          'Earthwork and filling',   20),
  ('FOUNDATION',         'Foundation',              30),
  ('SUBSTRUCTURE',       'Substructure',            40),
  ('SUPERSTRUCTURE',     'Superstructure',          50),
  ('MASONRY',            'Masonry and blockwork',   60),
  ('ROADWORK',           'Roadwork and paving',     70),
  ('FINISHES',           'Finishes and waterproofing', 80),
  ('SERVICES',           'Electrical, plumbing, fire, HVAC', 90)
on conflict (code) do nothing;

-- Test catalog (s5) ---------------------------------------------------------
insert into eworks.test_catalog (code, name, domain, default_is_code, requires_nabl, typical_tat_days) values
  ('SOIL_BEARING_CAPACITY',   'Safe bearing capacity (plate load)', 'SOIL_GEOTECH', 'IS 1888',  true,  7),
  ('SOIL_COMPACTION_PROCTOR', 'Compaction / Proctor density',       'SOIL_GEOTECH', 'IS 2720',  true,  3),
  ('CONCRETE_MIX_DESIGN',     'Concrete mix design',                'CONCRETE',     'IS 10262', true, 28),
  ('CONCRETE_CUBE_STRENGTH',  'Cube compressive strength',          'CONCRETE',     'IS 516',   true, 28),
  ('CONCRETE_SLUMP',          'Slump / workability',                'CONCRETE',     'IS 1199',  false, 1),
  ('CONCRETE_NDT_UPV',        'Ultrasonic pulse velocity (NDT)',    'CONCRETE',     'IS 13311', true,  2),
  ('CEMENT_PHYSICAL',         'Cement physical properties',         'CEMENT',       'IS 4031',  true,  7),
  ('AGGREGATE_GRADING',       'Aggregate grading and properties',   'AGGREGATE',    'IS 2386',  true,  3),
  ('WATER_QUALITY',           'Water quality for construction',     'WATER',        'IS 3025',  true,  5),
  ('STEEL_TENSILE',           'Rebar tensile and bend',             'STEEL_REBAR',  'IS 1608',  true,  3),
  ('BRICK_COMPRESSIVE',       'Brick compressive strength',         'MASONRY',      'IS 3495',  true,  5),
  ('BITUMEN_PENETRATION',     'Bitumen penetration grade',          'BITUMEN_ROAD', 'IS 73',    true,  3)
on conflict (code) do nothing;

-- Stage rules (s5 layer 2). Frequencies are DATA. ---------------------------
--
-- The IS 456 concrete sampling ladder is the canonical example of a rule that
-- must never be an `if` chain: 1 sample for 1-5 m3, 2 for 6-15, 3 for 16-30,
-- 4 for 31-50, then 4 plus one per additional 50 m3.
insert into eworks.test_stage_rules
  (test_id, stage_id, frequency_type, frequency_spec, is_code, acceptance_criteria)
select tc.id, cs.id, 'PER_VOLUME',
  jsonb_build_object(
    'unit', 'm3',
    'tiers', jsonb_build_array(
      jsonb_build_object('upto',  5, 'samples', 1),
      jsonb_build_object('upto', 15, 'samples', 2),
      jsonb_build_object('upto', 30, 'samples', 3),
      jsonb_build_object('upto', 50, 'samples', 4)
    ),
    'above', jsonb_build_object('base_samples', 4, 'per_additional_m3', 50, 'add_samples', 1),
    'specimens_per_sample', 3,
    'test_ages_days', jsonb_build_array(7, 28)
  ),
  'IS 516',
  -- `min_from` defers the threshold to the project's concrete grade rather
  -- than freezing M25 into the catalog. The pass/fail engine resolves it.
  jsonb_build_object(
    'metric', 'strength_n_per_mm2',
    'min_from', 'project.concrete_grade_characteristic_strength',
    'age_days', 28,
    'source', 'IS 456 cl.16 / project QAP'
  )
from eworks.test_catalog tc, eworks.construction_stage cs
where tc.code = 'CONCRETE_CUBE_STRENGTH' and cs.code = 'SUPERSTRUCTURE'
on conflict do nothing;

insert into eworks.test_stage_rules
  (test_id, stage_id, frequency_type, frequency_spec, is_code, acceptance_criteria)
select tc.id, cs.id, 'PER_CONSIGNMENT',
  jsonb_build_object('unit', 'consignment', 'samples', 1),
  'IS 4031',
  jsonb_build_object('metric', 'compressive_strength_28d_n_per_mm2',
                     'min_from', 'material.cement_grade', 'source', 'IS 269 / IS 8112')
from eworks.test_catalog tc, eworks.construction_stage cs
where tc.code = 'CEMENT_PHYSICAL' and cs.code = 'SUPERSTRUCTURE'
on conflict do nothing;

insert into eworks.test_stage_rules
  (test_id, stage_id, frequency_type, frequency_spec, is_code, acceptance_criteria)
select tc.id, cs.id, 'PER_HEAT',
  jsonb_build_object('unit', 'heat', 'samples', 1, 'max_tonnes_per_heat', 40),
  'IS 1608',
  jsonb_build_object('metric', 'yield_strength_n_per_mm2',
                     'min_from', 'material.rebar_grade', 'source', 'IS 1786')
from eworks.test_catalog tc, eworks.construction_stage cs
where tc.code = 'STEEL_TENSILE' and cs.code = 'SUPERSTRUCTURE'
on conflict do nothing;

-- One-time tests (s5: "One-time tests (soil bearing, mix design, ...)").
insert into eworks.test_stage_rules
  (test_id, stage_id, frequency_type, frequency_spec, is_code, acceptance_criteria)
select tc.id, cs.id, 'ONCE', '{}'::jsonb, tc.default_is_code,
  jsonb_build_object('metric', 'safe_bearing_capacity_kn_per_m2',
                     'min_from', 'project.design_sbc', 'source', 'IS 1888 / design basis')
from eworks.test_catalog tc, eworks.construction_stage cs
where tc.code = 'SOIL_BEARING_CAPACITY' and cs.code = 'SITE_INVESTIGATION'
on conflict do nothing;

insert into eworks.test_stage_rules
  (test_id, stage_id, frequency_type, frequency_spec, is_code, acceptance_criteria)
select tc.id, cs.id, 'PER_LAYER',
  jsonb_build_object('unit', 'layer', 'samples', 1, 'area_per_sample_m2', 500),
  'IS 2720',
  jsonb_build_object('metric', 'degree_of_compaction_pct', 'min', 95,
                     'source', 'MoRTH / project QAP')
from eworks.test_catalog tc, eworks.construction_stage cs
where tc.code = 'SOIL_COMPACTION_PROCTOR' and cs.code = 'EARTHWORK'
on conflict do nothing;

insert into eworks.test_stage_rules
  (test_id, stage_id, frequency_type, frequency_spec, is_code, acceptance_criteria)
select tc.id, cs.id, 'PER_STAGE',
  jsonb_build_object('unit', 'pour', 'samples', 1),
  'IS 1199',
  jsonb_build_object('metric', 'slump_mm', 'min_from', 'project.design_slump_min',
                     'max_from', 'project.design_slump_max', 'source', 'IS 456 cl.7')
from eworks.test_catalog tc, eworks.construction_stage cs
where tc.code = 'CONCRETE_SLUMP' and cs.code = 'SUPERSTRUCTURE'
on conflict do nothing;
