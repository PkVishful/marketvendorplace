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

## 8. The fraud engine is not AI yet, and should not be first

§9 lists an AI fraud engine. The initial implementation should be deterministic
rules — duplicate QR, GPS outside geofence, duplicate photo hash, out-of-range
results, vendor–contractor conflict of interest, impossible timing. These catch
most real fraud and, critically, an auditor can explain them in a hearing. A
model that says "0.87 suspicious" cannot be cross-examined.
