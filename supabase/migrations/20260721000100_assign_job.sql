-- Self-service award acceptance. Awarding an order records a winner in
-- order_award but does not create the field job, and app users hold only
-- SELECT on test_jobs -- so the winning lab could never start work. This lets
-- the winner's owner accept the award, creating the job with themselves as the
-- technician (MVP: a vendor is effectively its owner).
--
-- SECURITY DEFINER because the insert needs privileges the caller lacks, but it
-- re-derives the winner from order_award and checks ownership against the
-- caller -- it never trusts a passed-in vendor or technician. The award-check
-- trigger and unique(order_id) still backstop it.
create or replace function eworks.assign_job(p_order_id uuid)
returns eworks.test_jobs
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order  eworks.test_orders;
  v_vendor uuid;
  v_owns   boolean;
  v_job    eworks.test_jobs;
begin
  select * into v_order from eworks.test_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status <> 'AWARDED' then
    raise exception 'order % is % and has no award to accept', p_order_id, v_order.status;
  end if;

  select vendor_id into v_vendor from eworks.order_award where order_id = p_order_id;
  if v_vendor is null then
    raise exception 'order % has no recorded award', p_order_id;
  end if;

  select exists (
    select 1 from eworks.vendors v
     where v.id = v_vendor and v.owner_user_id = eworks.current_user_id()
  ) into v_owns;
  if not v_owns then
    raise exception 'only the winning vendor''s owner may accept order %', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into eworks.test_jobs (order_id, vendor_id, technician_id)
  values (p_order_id, v_vendor, eworks.current_user_id())
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function eworks.assign_job(uuid) to eworks_authenticated;
