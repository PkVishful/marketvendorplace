# E-Works Construction Testing & Certification Marketplace — Master Build Prompt

*A production module of the E-Works government public works platform. Self-contained build brief. Tamil Nadu context (38 districts).*

---

## 0. How to use this prompt

You are building a real, deployable QA e-procurement module — not a demo. Rules that override convenience:

- No hardcoded business logic. Test frequencies, acceptance criteria, and workflow rules are **configurable data** (IS-code tables + per-project QAP), never baked into code.
- Authorization is enforced **in the database** (Row-Level Security), not only in the app — a leaked key must not read outside its scope.
- Every state-changing action is written to an **immutable, hash-chained audit log**.
- Confirm **data residency** early: government data must sit on approved infra (MeitY-empanelled / NIC / State Data Centre). This may require self-hosting Supabase.

---

## 1. Objective and context

A transparent, auditable marketplace where government engineers request material tests, verified private labs compete for the work, and results become tamper-evident certificates linked to the E-Works project record.

- **Buyer:** government department (public money, legal QA obligations under IS codes).
- **Sellers:** private testing labs and contractors (NABL / PWD accredited).
- **Why:** replace informal, paper-based, single-lab testing with open competition, provable chain-of-custody, and a permanent audit trail.

---

## 2. Confirmed technology stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React + TypeScript, served via CDN; permission-gated routing |
| Auth/BFF | Supabase Edge Functions (Deno) — hold session server-side, issue **HTTP-only cookies** |
| Database | Supabase PostgreSQL + **Supavisor** transaction pooler + read replicas + **PostGIS** |
| Auth provider | Supabase Auth (GoTrue) + MFA/TOTP |
| Storage | Supabase Storage + **ClamAV** scan sidecar + signed expiring URLs |
| Queue / jobs | pgmq (broadcast) + pg_cron (timed bid-close, escalation timers) |
| Cache | Redis (hot data) + CDN edge cache |
| Perimeter | Cloudflare WAF + DDoS + rate limiting + bot management |
| Secrets | Supabase Vault / KMS (PII columns encrypted) |
| Observability | Supabase logs + Sentry |

---

## 3. Roles and logins — ground level to top

Everyone logs in with **mobile number + OTP**; officers and vendors add **MFA**. On login the BFF issues an **RS256 JWT in an HTTP-only cookie** carrying the user's role and org-unit scope; access 15 min, refresh 7 days with rotation, device/session binding, JTI blacklist. RLS enforces scope on every query.

| Role (ground → top) | Scope | Portal | Key actions |
|---|---|---|---|
| Field technician (lab) | Assigned job | Mobile | Geo-fenced check-in, generate/bind serialized QR, collect samples |
| Lab vendor owner/manager | Own lab | Mobile + desktop | KYC, capabilities, pricing, bids, jobs, earnings, upload certificates |
| Site engineer (JE/AE) | Section / subdivision | Gov portal | Raise test request, float order, verify certificate, field sign-off |
| Executive engineer (EE) | Division | Gov portal | Review/award higher-value orders, oversight |
| Superintending engineer / district officer | Circle / district | Gov portal | **Verify & approve vendors**, district oversight |
| Auditor | Assigned scope | Gov portal | Read-only across records + full audit log |
| Head admin (department) | State | Gov portal | Setup districts, manage users/roles, manage test catalog, all KYC, settings |
| AI service account | System | — | Fraud/verification checks (non-interactive) |

Engineer and admin share one government portal (admin has extra screens). Vendors use a separate portal. A district's officer sees only their district; RLS makes cross-district access impossible.

---

## 4. Organisation hierarchy

`State → District → Division → Circle → Subdivision → Section → Field Unit → Project`. Every record belongs to a unit; no orphans; strict FK + level validation. Access delegates downward — a permission held at unit U applies to U's whole subtree (ltree ancestor match). Implemented as one `org_units` table with a materialized path and a GiST index.

---

## 5. Test catalog and rules (configurable)

Three layers, so "repetitive vs once" needs no duplication:

1. **Test catalog** — master list of test types (e.g. `CONCRETE_CUBE_STRENGTH`), each with domain, default IS code, `requires_nabl`.
2. **Stage rules** — when/how often a test fires: `ONCE`, `PER_STAGE`, `PER_LOT`, `PER_VOLUME`, `PER_AREA`, `PER_LAYER`, `PER_HEAT`, `PER_CONSIGNMENT`.
3. **Project test requirements** — instances generated for a project from its stages (these become orders).

Coverage (indicative — reconcile with IS codes + project QAP): soil/geotech, concrete (cube, slump, NDT), cement, aggregates, water, steel/rebar + weld NDT, masonry, bitumen/road, waterproofing/finishes, electrical, plumbing/fire/HVAC. One-time tests (soil bearing, mix design, source approval) vs milestone-driven tests (cubes per pour, cement per consignment, steel per heat).

---

## 6. Data model (new tables)

Reuse the E-Works foundation: `org_units`, `user_profiles`, `roles`, `permissions`, `user_roles`, `audit_logs`, RLS helpers.

- Catalog: `construction_stage`, `test_catalog`, `test_stage_rules`, `project_test_requirements`
- Vendors: `vendors` (GSTIN, PAN, address, GPS, service_radius_km, `is_govt_approved`, `nabl_no`, status), `vendor_documents`, `vendor_test_capabilities` (accredited per test), `vendor_test_pricing`
- Orders/bids: `test_orders` (sealed RFQ, eval_method, status), `order_items`, `order_bids` (encrypted until close), `order_award`
- Execution: `test_jobs`, `chain_of_custody` (QR, geo, timestamp, hash-chained), `test_results` (values, pass/fail, signed cert, verified_by)
- Payment: `payments` (treasury/PFMS ref, GST invoice, held-until-certificate, idempotency key)

---

## 7. Real-world operating flow

1. **Project setup** — PM registers site + concrete volume / steel tonnage / foundation type. System generates the testing calendar from *configurable* IS + QAP rules.
2. **Milestone trigger** — site engineer requests a pour/stage. System builds a **sealed RFQ** (e.g. 1 slump + 6 cubes with 7/28-day dates), matches vendors by geo-radius + capability + valid accreditation, broadcasts via pgmq (SMS/push/web).
3. **Sealed bidding** — vendors submit encrypted bids; technical-qualification lock auto-rejects expired NABL/PWD. At the scheduled close, `pg_cron` opens bids atomically and awards **L1 among the technically-qualified** (single winner, row-locked).
4. **Ground execution** — technician does a server-verified **geo-fenced check-in** (GPS + timestamp + photo + device binding), molds cubes, generates and embeds **native serialized QR**, scans to bind blocks to the milestone; transports to lab. Chain-of-custody hash-chained.
5. **Testing → certificate → payout** — on day 7/28 the lab enters load (kN) → strength (N/mm²) and uploads a **cryptographically signed PDF**. Pass/fail engine: PASS → milestone verified (green); **FAIL → escalation** (core/NDT/structural sign-off), not a naive block — construction proceeds provisionally on the 7-day result. On a valid certificate, payment releases via **treasury/PFMS** (held until then). Everything written immutably for the E-Works audit.

---

## 8. UI / UX

Principles: **one primary action per screen**, minimal typing (price is often the only input — everything else pre-filled), status by **colour** not paragraphs, security invisible to the user, mobile-first for vendor/field and desktop-first for officers, **offline capture** on the field app (check-in + QR bind stored locally, synced when back online).

Key screens:
- Lab mobile: live orders feed (nearby, one "Place bid"), sealed bid sheet (price only), jobs, earnings.
- Field mobile: geo-fenced check-in, QR generation/binding, seal-and-confirm-pickup, day-7/28 result entry.
- Vendor KYC wizard: details + document uploads (PAN company/proprietor, GST, NABL cert + scope, registration, address proof, ID + selfie, bank), each shown to admin as a viewable image with approve/reject.
- Officer desktop: float-order builder, bid comparison + award, **quality dashboard** (green/amber/red milestones with auto-escalation), vendor approval queue.

---

## 9. Security architecture (defense in depth)

- **Perimeter:** Cloudflare WAF, DDoS, rate limiting, bot management.
- **Transport:** TLS 1.3.
- **Identity:** phone + OTP + MFA; RS256 JWT in HTTP-only cookies via BFF; refresh rotation; device/session binding; JTI blacklist.
- **Authorization:** RLS scoped by org-unit subtree; vendor sees only eligible floated orders and own bids/jobs.
- **Bidding integrity:** bids encrypted at rest, un-openable (even by admin) until close; auto-open logged.
- **Site anti-fraud:** server-verified geo-fence + photo + timestamp + device binding; unique QR + hash-chained chain-of-custody.
- **Certificate authenticity:** verify signed-PDF signature, store hash, public QR verification.
- **Files:** MIME + magic-byte validation, virus scan, expiring signed URLs.
- **Money:** idempotent payment ops, segregated, audited.
- **Fraud engine (AI):** ghost project, fake/duplicate photo, GPS mismatch, duplicate QR, duplicate billing, out-of-range results, vendor–contractor conflict of interest, timing anomalies.
- **Attack coverage:** SQLi/XSS/CSRF/enumeration/brute-force/DDoS → WAF + parameterized access + cookies; broken access control / privilege escalation → RLS; file exploits → scan/validate; replay/hijacking → rotation + binding; tamper → hash-chained audit.

---

## 10. Scalability

Load is spiky at bid-broadcast and bid-close. Handle with: pgmq for fan-out notifications; read replicas + cached vendor-match for the live order board; Supavisor pooler (mandatory); `pg_cron` timed bid-close with atomic, row-locked award (exactly one winner); time-partitioning of `test_orders`, `order_bids`, `audit_logs`, `chain_of_custody`, `notifications`. Government + vendor scale is comfortable; crore-scale citizen concurrency is achievable when these are designed in from day one.

---

## 11. Indexing

| Hot query | Index |
|---|---|
| Vendors within radius doing test X with valid NABL | **PostGIS `geography` + GiST** (highest priority) + partial index on verified/active + `(vendor_id, test_id)` + accreditation validity |
| Live order board (open RFQs) | Partial index `WHERE status='FLOATED'` on `(org_unit_id, milestone, required_by)` |
| One active bid per vendor per order | **Unique** `(order_id, vendor_id)` |
| L1 selection at close | `(order_id, price)` filtered to qualified |
| QR / cube lookup | **Unique** `(qr_code)` |
| Certificate by project + milestone | `(project_id, milestone)` |
| Vendor notification feed | `(vendor_id, created_at DESC)` |
| Org-subtree RLS | GiST on `org_units.path` |

The radius query runs on every floated order — the spatial index is the single most performance-critical decision.

---

## 12. Payment model

Government is the buyer, private labs/contractors are the payees. Payment routes through **treasury/PFMS** against a GST invoice, **held until a valid certificate exists** (built-in escrow-style safety without a separate wallet). Support a pre-funded escrow wallet only if serving private clients. All payment operations idempotent and audited.

---

## 13. Build sequence

- **Phase 0** — Schema: `test_catalog`, `construction_stage`, `test_stage_rules` + seeded catalog.
- **Phase 1** — Vendor onboarding + KYC + admin approval + "verified" notification.
- **Phase 2** — Vendor capabilities + pricing dashboard.
- **Phase 3** — Requirement planner → float sealed orders.
- **Phase 4** — Sealed bidding + eligibility lock + atomic L1 award.
- **Phase 5** — Ground execution (geo-fence + QR) → certificate → pass/fail + escalation → treasury payment → immutable audit.
- **Phase 6** — Notifications, vendor ratings, analytics.

Each phase reuses the same auth / RLS / audit spine.

---

## 14. Non-negotiables (acceptance criteria)

Configurable rules (no hardcoded frequencies) · sealed-bid integrity · RLS enforced in the database · immutable hash-chained audit · NABL-eligibility-per-test · server-verified geo-fence + QR chain-of-custody · signed-certificate verification · treasury-linked payment held until certificate · phone+OTP+MFA with HTTP-only cookie JWTs · confirmed data residency on approved government infrastructure.
