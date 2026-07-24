-- Tender & Budget oversight: let read-only oversight roles see REVEALED bids.
--
-- The oversight ledger is meant to show "all revealed bid amounts with vendor
-- names (only after bidding closed)" to HEAD_ADMIN and AUDITOR. But the only
-- officer path into order_bids (order_bids_officer_read_after_close) requires
-- `order.award`, which those two roles do not hold -- so the bid dimension was
-- invisible to exactly the screen's intended audience.
--
-- This adds a parallel, MORE RESTRICTIVE policy for `order.read` holders:
--   * only REVEALED bids (revealed_price_paise is not null),
--   * only after the window has closed (never during the float),
--   * only within the caller's org scope.
-- Sealed confidentiality is preserved: a FLOATED order's bids stay hidden, and
-- unrevealed/forfeited commitments are never exposed to order.read holders.
-- This mirrors order_award_read, which already scopes award visibility on
-- `order.read`. RLS policies are permissive (OR-ed), so this only grants; it
-- cannot widen what the officer policy already allowed.

create policy order_bids_oversight_read_after_close on eworks.order_bids
  for select to eworks_authenticated
  using (
    revealed_price_paise is not null
    and exists (
      select 1 from eworks.test_orders o
        join eworks.org_units ou on ou.id = o.org_unit_id
       where o.id = order_bids.order_id
         and o.status in ('REVEALING', 'AWARDED', 'FAILED', 'CANCELLED')
         and eworks.has_permission('order.read', ou.path)
    )
  );
