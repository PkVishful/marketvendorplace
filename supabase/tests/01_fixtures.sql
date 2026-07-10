-- Test fixtures: two districts, so cross-district isolation can be proven
-- rather than asserted.
--
-- Runs as the table owner (superuser), which bypasses RLS. That is deliberate:
-- the fixture must build a tree that the users under test are not allowed to
-- see, otherwise the isolation tests would prove nothing.

begin;

-- Org tree. Levels must descend by exactly one (see org_units_maintain_path).
--   TN
--   +- COIMBATORE (district)
--   |  +- CBEDIV1 -> CBEC1 -> CBESD1 -> CBESEC1 -> CBEFU1 -> CBEPRJ1
--   +- SALEM (district)
--      +- SLMDIV1 -> SLMC1 -> SLMSD1 -> SLMSEC1 -> SLMFU1 -> SLMPRJ1
insert into eworks.org_units (id, parent_id, level, code, name) values
  ('11111111-0000-0000-0000-000000000001', null, 'STATE', 'TN', 'Tamil Nadu'),

  ('11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'DISTRICT', 'COIMBATORE', 'Coimbatore'),
  ('11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'DIVISION',   'CBEDIV1',  'Coimbatore Division 1'),
  ('11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000003', 'CIRCLE',     'CBEC1',    'Coimbatore Circle 1'),
  ('11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000004', 'SUBDIVISION','CBESD1',   'Coimbatore Subdivision 1'),
  ('11111111-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000005', 'SECTION',    'CBESEC1',  'Coimbatore Section 1'),
  ('11111111-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000006', 'FIELD_UNIT', 'CBEFU1',   'Coimbatore Field Unit 1'),
  ('11111111-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000007', 'PROJECT',    'CBEPRJ1',  'Coimbatore Flyover'),

  -- A sibling Section under the same Subdivision, to prove that a Section
  -- engineer cannot reach sideways.
  ('11111111-0000-0000-0000-00000000000f', '11111111-0000-0000-0000-000000000005', 'SECTION',    'CBESEC2',  'Coimbatore Section 2'),

  ('11111111-0000-0000-0000-000000000009', '11111111-0000-0000-0000-000000000001', 'DISTRICT', 'SALEM', 'Salem'),
  ('11111111-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000009', 'DIVISION',   'SLMDIV1',  'Salem Division 1'),
  ('11111111-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000000a', 'CIRCLE',     'SLMC1',    'Salem Circle 1'),
  ('11111111-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-00000000000b', 'SUBDIVISION','SLMSD1',   'Salem Subdivision 1'),
  ('11111111-0000-0000-0000-00000000000d', '11111111-0000-0000-0000-00000000000c', 'SECTION',    'SLMSEC1',  'Salem Section 1'),
  ('11111111-0000-0000-0000-00000000000e', '11111111-0000-0000-0000-00000000000d', 'FIELD_UNIT', 'SLMFU1',   'Salem Field Unit 1'),
  ('11111111-0000-0000-0000-000000000010', '11111111-0000-0000-0000-00000000000e', 'PROJECT',    'SLMPRJ1',  'Salem Bypass');

-- Users
insert into eworks.user_profiles (id, phone, full_name) values
  ('22222222-0000-0000-0000-00000000000a', '9000000001', 'Head Admin'),
  ('22222222-0000-0000-0000-00000000000b', '9000000002', 'Coimbatore District Officer'),
  ('22222222-0000-0000-0000-00000000000c', '9000000003', 'Salem District Officer'),
  ('22222222-0000-0000-0000-00000000000d', '9000000004', 'Coimbatore Section Engineer'),
  ('22222222-0000-0000-0000-00000000000e', '9000000005', 'Coimbatore Auditor');

insert into eworks.user_roles (user_id, role_code, org_unit_id) values
  ('22222222-0000-0000-0000-00000000000a', 'HEAD_ADMIN',       '11111111-0000-0000-0000-000000000001'), -- TN
  ('22222222-0000-0000-0000-00000000000b', 'DISTRICT_OFFICER', '11111111-0000-0000-0000-000000000002'), -- Coimbatore
  ('22222222-0000-0000-0000-00000000000c', 'DISTRICT_OFFICER', '11111111-0000-0000-0000-000000000009'), -- Salem
  ('22222222-0000-0000-0000-00000000000d', 'SITE_ENGINEER',    '11111111-0000-0000-0000-000000000006'), -- CBESEC1
  ('22222222-0000-0000-0000-00000000000e', 'AUDITOR',          '11111111-0000-0000-0000-000000000002'); -- Coimbatore

commit;
