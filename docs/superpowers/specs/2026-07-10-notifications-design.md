# Phase 6a — Notifications: design

Status: awaiting review. Supersedes nothing. Scope is **notifications only**.
Vendor ratings and analytics, the other two thirds of the master prompt's §13
Phase 6 line, are deliberately out of scope and get their own specs.

## Why notifications come first

§13 bundles three subsystems into one line, but they are not equally specified.

- **Notifications** has real requirements spread across the prompt: §7 step 2
  (broadcast a floated order to matched vendors), §11 (a `(vendor_id,
  created_at DESC)` feed index), §10 (time-partition `notifications`), and
  Phase 1's still-unpaid "verified notification".
- **Analytics** has one anchor: §8's quality dashboard, green/amber/red
  milestones with auto-escalation. It reads existing data and adds no write path.
- **Vendor ratings** appears exactly once in the entire prompt — inside the §13
  line itself. Nothing says what is rated, by whom, or what a rating changes.
  Designing it now would force an early, unforced decision about whether a
  rating perturbs award, and today's award is strict L1 among the technically
  qualified.

Notifications also unblocks the other two: both can consume its event stream.

## The fairness argument that shapes the whole design

Phase 4 is commit–reveal. A vendor who does not reveal before
`test_orders.reveal_close_at` is marked `FORFEITED` (`eworks.bid_status`), and
`docs/security-gaps.md` #1 notes an EMD penalty must attach to that in the
tender conditions.

A vendor who is never *told* the reveal window opened therefore loses their bid
and their deposit through no fault of their own. Under the encrypt-at-rest
scheme the prompt originally described, a reveal notice would be a convenience.
Under commit–reveal it is part of the fairness guarantee, and it will be
litigated.

So the system must be able to answer, on the record:

> Was this vendor notified that the reveal window opened, and when?

That single question is why the design has three tables rather than two.

## Deliberate divergences

Each is a decision. Both belong in the README's divergence list on merge.

### 1. A plain outbox table, not `pgmq`

§7 names `pgmq`. `pgmq` is an extension; it is tables and functions over
`FOR UPDATE SKIP LOCKED`. A plain `notification_deliveries` table drained the
same way has identical at-least-once, competing-consumers semantics with no
extension to install.

This matters because of divergence #1 already in the README ("plain
PostgreSQL, not Supabase-coupled") and the residency argument in
`security-gaps.md` #2: a NIC or State Data Centre cluster must take these
migrations unchanged. It also matters for verification — `scripts/db-test.sh`
already contorts itself to skip PostGIS-dependent migrations on a stock
cluster, and a second optional extension would leave Phase 6 the only
unverified phase on most machines.

### 2. Partition-ready, not partitioned

§10 lists `notifications` among the tables to time-partition and says these
things must be designed in from day one. The claim that is actually true is
that the *key choice* is expensive to retrofit, not that the partitions
themselves are.

`notifications` therefore gets a `(created_at, id)` primary key and nothing
ever references `notifications.id` alone. Converting to monthly `RANGE`
partitioning later is an `ALTER` with no schema break. See "Future
partitioning" below for the exact migration and the trap it avoids.

### 3. Notifications are not written to the audit log

Every event that produces a notification is a state change that
`audit_logs_seal()` has already recorded. Emitting a second audit row per
notification would add nothing and would cost a great deal: `audit_logs_seal()`
takes `pg_advisory_xact_lock` to stop the hash chain forking, so audit appends
are single-threaded (`security-gaps.md` #4). Fanning out inside that lock would
run the radius query — which §11 calls the most performance-critical query in
the system — against the one serialised resource, at exactly the bid-broadcast
spike §10 warns about.

The rejected-but-tempting variant is worth recording: a trigger on `audit_logs`
would be an elegant universal event stream and would automatically cover every
future state change. It is rejected for the reason above.

## Data model

New enums, all in `eworks`:

```
notification_event_type:
  VENDOR_APPROVED, VENDOR_REJECTED,
  ORDER_FLOATED, REVEAL_WINDOW_OPEN,
  AWARD_WON, AWARD_LOST, ORDER_FAILED

notification_channel: SMS, PUSH
delivery_status:      PENDING, CLAIMED, DELIVERED, FAILED, DEAD
```

`WEB` is not a channel. The in-app feed *is* the `notifications` table; there is
nothing to deliver.

### `notification_events`

The event, recorded once, regardless of how many people hear about it.

| column | type | note |
|---|---|---|
| `id` | `uuid` pk | |
| `event_type` | `notification_event_type` | |
| `order_id` | `uuid` null → `test_orders(id)` on delete cascade | |
| `vendor_id` | `uuid` null → `vendors(id)` on delete cascade | |
| `org_path` | `ltree` not null | scoping for auditors, mirrors `audit_logs` |
| `occurred_at` | `timestamptz` not null default `now()` | |

Constraint: exactly one of `order_id` / `vendor_id` is non-null, and which one
is determined by `event_type` (order events carry `order_id`, vendor events
carry `vendor_id`).

`org_path` is resolved by the emitting trigger, not supplied by a caller: from
`org_units.path` of `test_orders.org_unit_id` for order events, and of
`vendors.org_unit_id` for vendor events. It is denormalised so the auditor read
policy never joins back to the subject table — whose own RLS would otherwise
hide the row and make the audit query silently incomplete.

Idempotency: a partial unique index on `(event_type, order_id)
WHERE order_id IS NOT NULL`. Every order-scoped event fires at most once per
order. This is what makes a re-run of `sweep_close_bidding()` or
`sweep_finalize_awards()` — both documented as idempotent and self-healing —
unable to double-notify.

No equivalent unique on `vendor_id`: a vendor may legitimately be `SUSPENDED`
and later `APPROVED` again, and each approval is a real event.

### `notifications`

One row per recipient. The only table RLS guards. Carries **no order content**.

| column | type | note |
|---|---|---|
| `id` | `uuid` default `gen_random_uuid()` | |
| `created_at` | `timestamptz` not null | **set to the event's `occurred_at`**, not `now()` |
| `event_id` | `uuid` not null → `notification_events(id)` on delete cascade | |
| `recipient_user_id` | `uuid` not null → `user_profiles(id)` | |
| `read_at` | `timestamptz` null | |

- Primary key `(created_at, id)`.
- Unique `(created_at, event_id, recipient_user_id)` — the fan-out dedup.
- Index `(recipient_user_id, created_at desc)` — §11's feed index.
- Partial index `(recipient_user_id) WHERE read_at IS NULL` — the unread badge.

**Why `created_at` is copied from the event and not defaulted to `now()`.** A
`UNIQUE` on a partitioned table must contain the partition key. Naively that
would degrade the dedup to `(created_at, event_id, recipient_user_id)` and stop
it deduplicating across a partition boundary. Because every recipient row for a
given event is stamped with that event's `occurred_at`, all of them land in the
same partition by construction, and the composite unique remains an exact
dedup after partitioning. This is the single subtlest line in the design.

`now()` would in fact also work today — it is transaction-start time and is
therefore constant within the fan-out transaction — but it ties correctness to
an incidental property of `now()`, and a future fan-out that spans two
transactions would break silently. Copying `occurred_at` states the intent.

### `notification_deliveries`

The outbox. `eworks_authenticated` holds **no privilege on this table at all**.

| column | type | note |
|---|---|---|
| `id` | `bigint` generated always as identity, pk | |
| `notification_created_at` | `timestamptz` not null | composite FK, half |
| `notification_id` | `uuid` not null | composite FK, half |
| `channel` | `notification_channel` not null | |
| `status` | `delivery_status` not null default `PENDING` | |
| `attempts` | `int` not null default 0 | |
| `next_attempt_at` | `timestamptz` not null default `now()` | exponential backoff |
| `claimed_at` | `timestamptz` null | |
| `claimed_by` | `text` null | worker identity, for stuck-claim recovery |
| `last_error` | `text` null | |
| `delivered_at` | `timestamptz` null | |

- Foreign key `(notification_created_at, notification_id)` → `notifications(created_at, id)` on delete cascade.
- Unique `(notification_created_at, notification_id, channel)` — exactly one delivery per channel per recipient.
- Partial index `(channel, next_attempt_at) WHERE status IN ('PENDING','FAILED')` — the claim query.

## Emission

`AFTER` triggers on the tables, not explicit calls inside the functions.

The order state machine already lives in a trigger, and `custody_seal()` sets
the precedent. Triggers are unbypassable: a direct `UPDATE` to
`test_orders.status` that skips `float_order()` still notifies. Explicit
`emit_event()` calls inside the functions would leave that hole, and unlike
`order_bids` — where `eworks_authenticated` holds no `INSERT`/`UPDATE` at all —
`test_orders` is directly writable by officers.

All trigger functions are `SECURITY DEFINER` with `search_path = eworks,
public, extensions, pg_temp`, matching existing style.

| trigger | fires on | event | recipients |
|---|---|---|---|
| `vendors` `AFTER UPDATE OF status` | → `APPROVED` | `VENDOR_APPROVED` | `vendors.owner_user_id` |
| | → `REJECTED` | `VENDOR_REJECTED` | `vendors.owner_user_id` |
| `test_orders` `AFTER UPDATE OF status` | → `FLOATED` | `ORDER_FLOATED` | `owner_user_id` of every vendor from `eligible_vendors_for_order(id)` |
| | → `REVEALING` | `REVEAL_WINDOW_OPEN` | `owner_user_id` of every vendor holding a `COMMITTED` bid on the order |
| | → `FAILED` | `ORDER_FAILED` | `test_orders.created_by` |
| `order_award` `AFTER INSERT` | | `AWARD_WON` | winner's `owner_user_id` |
| | | `AWARD_LOST` | `owner_user_id` of every other bidder with status `REVEALED` or `DISQUALIFIED` |

Each trigger guards on `OLD.status IS DISTINCT FROM NEW.status`, so a no-op
update notifies nobody.

`AWARD_LOST` goes to `REVEALED` and `DISQUALIFIED` bidders. A `FORFEITED`
bidder is not told they lost — they are told nothing, because they already
received `REVEAL_WINDOW_OPEN` and did not act. That asymmetry is intentional
and is exactly the record a forfeiture dispute turns on.

Not emitted, deferred with the rest of Phase 6: an award notice to the ordering
officer. `AWARD_WON`/`AWARD_LOST` are vendor-facing. The officer's view is the
analytics dashboard.

### Fan-out failure is a float failure

If `eligible_vendors_for_order()` raises inside the `ORDER_FLOATED` trigger,
the enclosing transaction rolls back and the order does not float.

This is deliberate. An order that floats while silently telling nobody is an
unfair tender that looks, from the officer's screen, exactly like a fair one.
A rolled-back float is loud, recoverable, and safe.

An order that floats to **zero** eligible vendors is a different thing and is
not an error: the event row exists with zero `notifications` rows. "Nobody
qualified" is a real, queryable fact and a test asserts it. It must never be
confused with "the fan-out crashed".

### Cost, stated plainly

The `ORDER_FLOATED` fan-out runs the PostGIS radius query inside the float
transaction. At department scale this is correct and cheap. If bid-broadcast
spikes ever make it bind, the fix is to insert the event row synchronously and
expand recipients from a worker — which is precisely what a queue buys, and is
a change to one trigger body. It is not needed now and is not built now.

## Security model

### RLS on `notifications`

```
read:  recipient_user_id = eworks.current_user_id()
       OR (auditor branch: has_permission('audit.read', event.org_path))
```

The self-access branch has precedent: `user_profiles_read` opens with
`id = eworks.current_user_id()`. The README's rule — *`in_scope()` answers
"where", never "whether"; a read policy must name a permission* — is honoured
because the second branch names `audit.read` and never leans on `in_scope()`
alone.

Grants to `eworks_authenticated`:

- `SELECT` on `notifications`.
- `UPDATE (read_at)` on `notifications` — a **column-level** grant. RLS cannot
  restrict columns, so this is what stops a vendor rewriting `event_id`.
- **No** `INSERT`, **no** `DELETE`. Only the `SECURITY DEFINER` triggers write.
- `SELECT` on `notification_events`, policied to events the caller has a
  `notifications` row for, or `has_permission_anywhere('audit.read_all')`.
- Nothing whatsoever on `notification_deliveries`.

### The delivery worker never touches a table

A new `eworks_notifier` role (`nologin`). It receives **no table grants**. It
gets `EXECUTE` on exactly two `SECURITY DEFINER` functions:

- `claim_deliveries(p_channel, p_limit, p_worker text)` — selects due rows
  `FOR UPDATE SKIP LOCKED`, marks them `CLAIMED`, and returns
  `(delivery_id, event_type, subject_id, recipient_phone)`.
- `complete_delivery(p_delivery_id, p_ok boolean, p_error text)` — marks
  `DELIVERED`, or increments `attempts`, records `last_error`, sets
  `next_attempt_at` by exponential backoff, and flips to `DEAD` past the
  attempt ceiling.

Consequences worth stating: the worker cannot read the feed, cannot enumerate
vendors or orders, and `service_role` is never involved. The README warns that
`service_role` bypasses RLS and makes every policy decorative; this design
gives it no reason to appear.

`recipient_phone` is the one PII exit. It is `user_profiles.phone`, which
`security-gaps.md` #5 records as plaintext pending a KMS decision. Confining it
to one function's return value means encrypting it later touches one place.

### `DEAD` is visible, never silent

A delivery that exhausts its attempts becomes `DEAD` with `last_error`
populated. It is not deleted and not retried. An operator query for
`status = 'DEAD'` is the "who did we fail to reach" report — which, for
`REVEAL_WINDOW_OPEN`, is a list of vendors about to be forfeited unfairly and
is the most operationally important query in this document.

## Testing

New file `supabase/tests/09_notifications.sql`, in the established style
(`pass:` lines counted by `db-test.sh`). Nineteen checks:

**Fan-out correctness**
1. Floating an order notifies exactly the eligible vendors — no more, no fewer.
2. A vendor outside its own `service_radius_km` is not notified.
3. A vendor with lapsed NABL on a required item is not notified.
4. An order floated with zero eligible vendors creates the event with zero
   recipient rows, and does not raise.

**The no-payload invariant**
5. A `notifications` row exposes no order column — asserted against
   `information_schema.columns`, so a later migration that adds a `title` fails
   this test.
6. A vendor notified at float, whose NABL lapses before they open the feed,
   still holds the notification row and reads **zero rows** from `test_orders`.
   Dead link, not leak. This is the test that reconciles the design with the
   README's "eligibility is recomputed per row, never cached".

**Isolation**
7. Vendor A cannot read vendor B's notification.
8. An unauthenticated connection reads zero notifications.
9. A vendor cannot `INSERT` or `DELETE` a notification (privilege, not policy —
   the test asserts the grant is absent).
10. A vendor cannot mark another vendor's notification read.
11. A vendor cannot `UPDATE` any column but `read_at` (column-level grant).
12. `eworks_authenticated` has no privilege at all on `notification_deliveries`
    — asserted via `has_table_privilege`.

**Event semantics**
13. `REVEAL_WINDOW_OPEN` reaches every `COMMITTED` bidder and nobody else.
14. `AWARD_WON` reaches the winner only; `AWARD_LOST` reaches the other
    revealed bidders; neither row discloses the winning price.
15. `ORDER_FAILED` reaches `test_orders.created_by`.
16. `VENDOR_APPROVED` reaches the owner; a competitor lab receives nothing.

**Idempotency, delivery, audit**
17. Re-running `sweep_finalize_awards()` produces no duplicate notification.
18. Two concurrent `claim_deliveries()` calls return disjoint sets, and a
    delivery that fails its attempt ceiling ends `DEAD` with `last_error` set —
    never silently dropped.
19. An auditor holding `audit.read_all` can answer *"was this vendor notified
    that the reveal window opened, and when?"* in one query across all three
    tables. **This is the check that justifies the third table.**

A twentieth assertion rides along inside #1: every recipient row for a single
event shares one `created_at`. That is what keeps the dedup unique valid after
partitioning, so it is asserted rather than assumed.

### Harness changes

`scripts/db-test.sh` needs `20260710000100_notifications.sql` and
`09_notifications.sql` added to `needs_postgis()` — the migration references
`test_orders`, and the tests float orders.

**Pre-existing bug found while reading it, to fix in the same change.** The
migration loop tests `[ "$base" = "$NEEDS_POSTGIS_MIGRATION" ]` against a
variable that is never assigned. Under `set -u` that aborts the script — but
only on a cluster without PostGIS, which is why it has never been seen. The
loop should call the `needs_postgis()` function that already exists and that
the *test* loop already uses. This is in scope because Phase 6 adds an entry to
exactly that machinery.

## Future partitioning

When volume demands it, and not before:

```sql
-- notifications is already keyed (created_at, id) and nothing references
-- notifications.id alone, so this is mechanical.
ALTER TABLE eworks.notifications RENAME TO notifications_unpartitioned;
CREATE TABLE eworks.notifications (LIKE eworks.notifications_unpartitioned
  INCLUDING ALL) PARTITION BY RANGE (created_at);
-- monthly partitions + a DEFAULT partition, then INSERT ... SELECT, then swap.
```

**The trap:** a partitioned parent's RLS policies apply to rows reached
*through the parent*. A partition queried **directly** — `SELECT FROM
eworks.notifications_2026_08` — enforces only the policies and grants on that
partition, not the parent's. So the partition-creation helper must both enable
RLS on each new partition and withhold any grant on it from
`eworks_authenticated`. A monthly partition created by hand, or by a helper
that forgets, is a silent hole through which one vendor reads another's feed.

Whatever creates monthly partitions must therefore ship with a test that
attaches a fresh partition, inserts a row, and asserts a non-recipient reads
zero rows from it both through the parent and directly. Do not partition
without that test.

## What this does not build

- SMS/push transport. The worker contract is `claim_deliveries` /
  `complete_delivery`; the process that speaks to a gateway is out of scope and
  cannot be verified by `db-test.sh`.
- Timed reminders ("bidding closes in 2h", "day-28 result due"). These need
  `pg_cron` sweepers, and the migrations deliberately do not install `pg_cron`.
- Execution and payment events (`JOB_ASSIGNED`, `ESCALATION_OPENED`,
  `CERTIFICATE_ISSUED`, `PAYMENT_RELEASED`). Each is a trigger and an enum
  value away once the spine is verified.
- Vendor ratings and analytics — separate specs.

## Files

| file | change |
|---|---|
| `supabase/migrations/20260710000100_notifications.sql` | new |
| `supabase/tests/09_notifications.sql` | new |
| `scripts/db-test.sh` | add Phase 6 to `needs_postgis()`; fix the unset `$NEEDS_POSTGIS_MIGRATION` |
| `README.md` | Phase 6a status; divergences #6 (outbox not pgmq) and #7 (partition-ready) |
| `docs/security-gaps.md` | note that `REVEAL_WINDOW_OPEN` delivery is now the operational control that makes the #1 forfeiture rule fair |
