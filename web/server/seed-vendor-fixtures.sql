-- Dev-only: committed vendor fixtures extracted from supabase/tests/03_vendors.sql

insert into eworks.user_roles (user_id, role_code, org_unit_id) values
  ('44444444-0000-0000-0000-00000000000a','LAB_VENDOR','11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-00000000000c','LAB_VENDOR','11111111-0000-0000-0000-000000000009'),
  ('44444444-0000-0000-0000-00000000000d','LAB_VENDOR','11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-00000000000e','LAB_VENDOR','11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-00000000000f','FIELD_TECHNICIAN','11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-000000000010','LAB_VENDOR','11111111-0000-0000-0000-000000000002')
on conflict do nothing;

insert into eworks.vendors
  (id, owner_user_id, org_unit_id, legal_name, gstin, pan, address,
   location, service_radius_km, status, approved_by, approved_at,
   nabl_no, nabl_valid_until)
values
  ('55555555-0000-0000-0000-00000000000a','44444444-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000002','Kovai Testing Labs Pvt Ltd',
   '33ABCDE1234F1Z5','ABCDE1234F','Coimbatore',
   st_makepoint(76.9800, 11.0200)::geography, 50, 'APPROVED',
   '22222222-0000-0000-0000-00000000000b', now(), 'TC-1001', current_date + 365),
  ('55555555-0000-0000-0000-00000000000c','44444444-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000009','Salem Statewide Labs',
   '33CDEFG3456H1Z7','CDEFG3456H','Salem',
   st_makepoint(78.1460, 11.6643)::geography, 200, 'APPROVED',
   '22222222-0000-0000-0000-00000000000c', now(), 'TC-1003', current_date + 365),
  ('55555555-0000-0000-0000-00000000000d','44444444-0000-0000-0000-00000000000d',
   '11111111-0000-0000-0000-000000000002','Lapsed Accreditation Labs',
   '33DEFGH4567I1Z8','DEFGH4567I','Coimbatore',
   st_makepoint(76.9700, 11.0180)::geography, 50, 'APPROVED',
   '22222222-0000-0000-0000-00000000000b', now(), 'TC-1004', current_date - 1),
  ('55555555-0000-0000-0000-00000000000e','44444444-0000-0000-0000-00000000000e',
   '11111111-0000-0000-0000-000000000002','Unapproved Labs',
   '33EFGHI5678J1Z9','EFGHI5678J','Coimbatore',
   st_makepoint(76.9650, 11.0170)::geography, 50, 'SUBMITTED',
   null, null, 'TC-1005', current_date + 365)
on conflict (id) do nothing;

insert into eworks.vendor_test_capabilities
  (vendor_id, test_id, is_nabl_accredited, nabl_scope_ref, accredited_from, accredited_to)
select v.id, tc.id, true, 'SCOPE-'||v.legal_name,
       current_date - 365,
       case when v.id = '55555555-0000-0000-0000-00000000000d'
            then current_date - 1 else current_date + 365 end
  from eworks.vendors v, eworks.test_catalog tc
 where tc.code = 'CONCRETE_CUBE_STRENGTH'
   and v.id in (
     '55555555-0000-0000-0000-00000000000a',
     '55555555-0000-0000-0000-00000000000c',
     '55555555-0000-0000-0000-00000000000d',
     '55555555-0000-0000-0000-00000000000e'
   )
on conflict do nothing;

insert into eworks.vendor_test_capabilities (vendor_id, test_id, is_nabl_accredited)
select '55555555-0000-0000-0000-00000000000d', tc.id, false
  from eworks.test_catalog tc where tc.code = 'CONCRETE_SLUMP'
on conflict do nothing;

insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise)
select v.id, tc.id, 250000
  from eworks.vendors v, eworks.test_catalog tc
 where tc.code = 'CONCRETE_CUBE_STRENGTH'
   and v.id in (
     '55555555-0000-0000-0000-00000000000a',
     '55555555-0000-0000-0000-00000000000c',
     '55555555-0000-0000-0000-00000000000d',
     '55555555-0000-0000-0000-00000000000e'
   )
on conflict do nothing;
