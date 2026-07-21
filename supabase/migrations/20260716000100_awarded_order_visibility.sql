-- The sealed-bid policies hide an AWARDED order from every vendor:
-- orders_vendor_read only covers FLOATED and REVEALING. But ground execution
-- reads the order through the job (test_jobs -> test_orders), so the winning
-- lab's owner and its assigned technician saw an empty jobs list the moment
-- they won. Grant the winner -- and only the winner -- read access for the
-- order's remaining lifetime.
--
-- order_award's own read policy references test_orders, so a policy that
-- queried order_award inline would recurse. SECURITY DEFINER bypasses RLS
-- inside the helper, exactly like eligible_vendors_for_order().

create or replace function eworks.user_won_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from eworks.order_award oa
      join eworks.vendors v on v.id = oa.vendor_id
     where oa.order_id = p_order_id
       and v.owner_user_id = eworks.current_user_id()
  ) or exists (
    select 1
      from eworks.test_jobs j
     where j.order_id = p_order_id
       and j.technician_id = eworks.current_user_id()
  );
$$;

comment on function eworks.user_won_order(uuid) is
  'True when the current user owns the vendor that won this order, or is the '
  'technician assigned to its job. RLS helper; bypasses row security so the '
  'test_orders policy cannot recurse through order_award.';

grant execute on function eworks.user_won_order(uuid) to eworks_authenticated;

create policy orders_vendor_awarded_read on eworks.test_orders
  for select using (eworks.user_won_order(id));
