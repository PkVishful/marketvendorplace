-- Works-tender: nav default — show the 'tenders' tab to the roles that hold contract.manage.
do $$
declare
  defaults jsonb := '{"DISTRICT_OFFICER":["tenders"],"EXECUTIVE_ENGINEER":["tenders"]}'::jsonb;
  role_key text; existing jsonb; merged jsonb;
begin
  insert into eworks.settings (key, value) values ('nav_visibility','{}'::jsonb) on conflict (key) do nothing;
  for role_key in select jsonb_object_keys(defaults) loop
    select coalesce(value -> role_key, '[]'::jsonb) into existing from eworks.settings where key='nav_visibility';
    select jsonb_agg(distinct tab) into merged from (
      select jsonb_array_elements_text(existing) as tab
      union select jsonb_array_elements_text(defaults -> role_key)) t;
    update eworks.settings set value = jsonb_set(value, array[role_key], coalesce(merged,'[]'::jsonb)) where key='nav_visibility';
  end loop;
end $$;
