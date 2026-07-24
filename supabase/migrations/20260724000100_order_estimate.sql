-- Officer's pre-tender cost estimate, set when an order is floated. Nullable:
-- older orders and orders floated without an estimate simply have none, and the
-- savings rollup excludes them (never treats a missing estimate as zero).
alter table eworks.test_orders
  add column estimated_amount_paise bigint;

comment on column eworks.test_orders.estimated_amount_paise is
  'Officer cost estimate at float time (paise). NULL = not estimated; excluded from savings.';
