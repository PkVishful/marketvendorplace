-- Removes everything the fixtures inserted, in FK-safe order.
--
-- Only touches rows with the fixed test UUID prefixes (1111…, 2222…, 4444…,
-- 5555…). It will never delete a row it did not create.

begin;

-- Vendors first: they reference org_units with ON DELETE RESTRICT.
-- Documents, capabilities and pricing cascade from the vendor.
delete from eworks.vendors where id::text like '55555555%';

-- user_roles cascades from user_profiles.
delete from eworks.user_profiles
 where id::text like '44444444%' or id::text like '22222222%';

-- org_units must go leaf-first: parent_id is ON DELETE RESTRICT.
do $$
declare depth int;
begin
  for depth in reverse 8..1 loop
    delete from eworks.org_units
     where nlevel(path) = depth and id::text like '11111111%';
  end loop;
end
$$;

commit;

\echo 'teardown complete'
