# Known security gaps

Every item here is a place where the master prompt states a guarantee that the
code does **not** currently deliver. Nothing in this list is hypothetical, and
nothing is hidden behind a "TODO" in a source file. If a gap is closed, delete
it from this document and add the test that keeps it closed.

## 1. Bid secrecy — RESOLVED (commit–reveal, Phase 4)

The master prompt (§9) asks for bids "encrypted at rest, un-openable (even by
admin) until close", opened by `pg_cron` at the scheduled time.

**This is not achievable as written.** If the database can decrypt at close,
the key is reachable by the database *before* close. Anyone with superuser or
Vault access can open bids early, and the only thing standing in their way is
the audit log — which records the read, but does not prevent it. In a
bid-rigging challenge, "we logged it" is not the same as "it could not happen."

**Implemented as commit–reveal** in `20260709001200_sealed_bids.sql`. A bid is
stored as `sha256(order_id : vendor_id : price : nonce)`. There is no plaintext
and no key, so early opening is impossible rather than merely forbidden. The
order and vendor ids are bound *into* the digest, so a commitment cannot be
lifted to another order or replayed by another vendor.

`reveal_bid()` recomputes the digest and rejects any mismatch, so a vendor
cannot undercut a rival by revealing a lower price than they committed to.

**Still a policy decision, not a code one:** a vendor who never reveals is
marked `FORFEITED`, but the EMD penalty attached to that must be written into
the tender conditions. Without a penalty, non-revelation is a free option to
withdraw after seeing the field.

**The operational control that makes forfeiture fair** arrived in Phase 6a. A
`REVEAL_WINDOW_OPEN` notification fires on `DRAFT -> REVEALING` to every vendor
holding a `COMMITTED` bid, and `eworks.notification_deliveries` records whether
it was delivered and when. Before disqualifying anyone, run:

    select * from eworks.notification_deliveries where status = 'DEAD';

Those are vendors the system failed to reach. Forfeiting one of them is
indefensible, and now provably so.

This is a DBA-scoped query, not something an auditor can run from the
application: `eworks_authenticated` holds no privilege on
`notification_deliveries` at all, by design, since the table also carries
every user's phone number. An auditor can confirm from `notification_events`
and `notifications` that the notice fired and reached this vendor; the
delivery outcome above must come from a DBA or an operator connection.

## 2. Data residency — unresolved, and it is a procurement decision

§14 lists "confirmed data residency on approved government infrastructure" as a
non-negotiable acceptance criterion. §0 simultaneously flags it as an open
question. It cannot be both.

Hosted Supabase is **not** MeitY-empanelled. Separately, several components the
prompt names — ClamAV sidecar, Redis, read replicas — are not available on
hosted Supabase at all.

**Mitigation applied:** the schema is plain PostgreSQL. Nothing depends on
Supabase-managed schemas, `auth.uid()`, or Edge Functions.
`eworks.current_user_id()` reads `app.user_id` (set by any BFF on a pooled
connection) *or* `request.jwt.claims` (set by PostgREST). A NIC / State Data
Centre deployment therefore requires no schema change.

**Still open:** where this actually runs. Until that is answered, go-live is
blocked regardless of how much code exists.

## 3. Audit log — tail truncation is undetectable from inside the database

`eworks.verify_audit_chain()` detects:

- modification of any row (the row's hash stops reproducing), and
- deletion of any row in the middle (the next row's `prev_hash` no longer
  matches), and
- deletion of a prefix (the first surviving row is not anchored to genesis).

It **cannot** detect deletion of the most recent *k* rows. A truncated chain is
internally consistent and verifies clean. This is asserted as a passing test in
`supabase/tests/02_rls_and_audit.sql`, deliberately, so nobody mistakes the
silence for safety.

**Required mitigation:** publish `eworks.audit_head()` (the latest `seq` and
`row_hash`) to a witness outside the database's trust boundary — a separate
system, an append-only object store with retention lock, or a periodic
notarised digest. Not yet implemented.

**Also true:** the chain does not *prevent* tampering. A superuser can
`ALTER TABLE ... DISABLE TRIGGER`. The chain makes the tampering loud. That is
the correct goal, but it should be stated plainly rather than described as
immutability.

## 4. Audit appends are serialized

`eworks.audit_logs_seal()` takes `pg_advisory_xact_lock` so that two concurrent
inserts cannot read the same chain tail and fork it. This makes audit writes
single-threaded.

At government + vendor write rates this is fine. It will bind long before
"crore-scale citizen concurrency" (§10). The fix at that point is per-org-unit
chains with periodic cross-linking, not abandoning the chain.

## 5. PII is stored in plaintext

§2 requires "Supabase Vault / KMS (PII columns encrypted)".
`eworks.user_profiles.phone` is currently plaintext. Encrypting it requires
choosing a KMS, which is blocked on gap #2.

## 6. Treasury / PFMS has no integration path yet

§12 requires payment "held until a valid certificate exists", released through
treasury/PFMS. That gating is implemented and tested: `release_payment()` is
idempotent, refuses without a signature-verified certificate, refuses while any
specimen lacks a result, and requires `order.award`.

**What does not exist is the disbursement itself.** `treasury_ref` is a text
column the caller supplies. PFMS access is granted through departmental
onboarding, not an API key. No money moves until your department integrates.

Note the deliberate design choice: payment is gated on a *certificate*, not on a
*pass*. A lab paid only when the cube passes has an incentive to report a pass.

## 7. Certificate signing needs a real DSC

§9 requires cryptographically signed PDF certificates. `eworks.certificates`
stores the SHA-256 of the uploaded bytes (so the served file can be proven
identical to the reviewed one) and a `signature_verified` flag.

RLS prevents a lab from setting that flag on its own upload. But **nothing yet
sets it truthfully** — there is no signature verifier, because issuing
signatures requires a Digital Signature Certificate from a licensed CA (eMudhra
and similar). Until one is procured, `signature_verified` must be set by a human
or a verifier service, and `release_payment()` will refuse to disburse without
it.

The public QR verification endpoint (§9) is not built.

## 8. Notifications — minor findings recorded, not fixed

Phase 6a's RLS design changed from the approved spec: the spec had
`notifications_read` and `notification_events_read` each subquery the other's
table, and PostgreSQL refuses that outright (`infinite recursion detected in
policy for relation "notifications"`), because both tables have RLS enabled and
each policy would have to evaluate the other. What shipped instead is two
`STABLE SECURITY DEFINER` helpers, `eworks.event_org_path()` and
`eworks.is_notification_recipient()` — the same idiom `has_permission()` already
uses to read the RLS-enabled `user_roles` table. The policies' meaning is
unchanged; a Salem officer holding `audit.read` for the wrong district still
reads zero rows of either table.

The delivery worker's contract also changed from the spec, and this one was a
Critical finding, not a style choice. The spec's `complete_delivery(p_delivery_id,
p_ok, p_error)` updates by `id` alone. Delivery ids are sequential `bigint`, so
any holder of `EXECUTE` — including a compromised SMS worker — could mark an
unclaimed row `DELIVERED`, flip a `DELIVERED` row back to `FAILED`, or resurrect
a `DEAD` one. Against a `REVEAL_WINDOW_OPEN` notice, that is the power to
manufacture the record a rival's earnest-money forfeiture rests on. What shipped
is `complete_delivery(p_delivery_id, p_worker, p_ok, p_error)`: every branch is
guarded on `status = 'CLAIMED' and claimed_by = p_worker` and raises when no row
matches. The claim is the authority, not the id; the old three-argument form is
dropped, not replaced. `claim_deliveries()` also reaps claims older than a
five-minute visibility timeout, so a worker that crashed after claiming does not
strand a notice forever, and clamps `p_limit` to `least(greatest(p_limit, 1),
1000)`, so one worker cannot claim the entire backlog.

A handful of smaller items surfaced during that work and are recorded here
rather than silently patched:

- A `HEAD_ADMIN` holding only `audit.read_all` can read `notification_events`
  but not `notifications`, because `notifications_read`'s audit branch names
  only `audit.read`. An `AUDITOR` holds both and is unaffected. More restrictive
  than a leak, but it means the forfeiture-dispute query in gap #1 works for an
  auditor and not for a head admin. **This is a policy decision the department
  should make, not a bug to quietly patch.**
- `notification_events_subject_matches_type` has no test exercising it.
- Two `check_raises` assertions in the delivery-worker tests have no companion
  state assertion.
- `greatest(p_limit, 1)` means a caller asking for zero deliveries gets one.
- Single-element `array_agg` assertions in the notification tests lack
  `order by` — latent flakiness only if someone later adds a second recipient to
  those scenarios.

## 9. The fraud engine is not AI yet, and should not be first

§9 lists an AI fraud engine. The initial implementation should be deterministic
rules — duplicate QR, GPS outside geofence, duplicate photo hash, out-of-range
results, vendor–contractor conflict of interest, impossible timing. These catch
most real fraud and, critically, an auditor can explain them in a hearing. A
model that says "0.87 suspicious" cannot be cross-examined.
