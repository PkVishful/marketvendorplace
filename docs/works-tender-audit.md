# Works-Tender Lifecycle — Codebase Audit

*Audit of the government works-tender lifecycle (tender notice → eligibility →
two-envelope bids → L1 award → LOA & security → construction → RA bills →
completion) against the current platform. Method: verify each item in code with
file:line evidence. Date: 2026-07-24.*

**Headline:** the contractor works-tender path (`contracts` / `contract_bids` /
`boq_items` / `material_deliveries` / `contractor_payments`, all in
`supabase/migrations/20260713000100_contracts_materials.sql`) is a deliberately
**light, single-envelope, amount-only bidding stub**. The rich two-envelope /
EMD / sealed-until-open / auto-L1 / forfeiture machinery that exists is entirely
in the **separate vendor test-order auction** (`…001200_sealed_bids.sql`) and is
out of scope. Of ~30 checklist items: **8 PRESENT, 4 PARTIAL, 17 MISSING** — and
two "PRESENT" DB capabilities (BOQ, delivery→auto-test) are **unreachable from
the app** (no BFF route / no UI).

Legend: ✅ PRESENT · 🟡 PARTIAL · ❌ MISSING

## A. Project & sanction
| Item | Status | Evidence |
|---|---|---|
| A1 Project record with estimated value at a PROJECT org unit | 🟡 | `20260713000100:190,194` + trigger `:212-226` force `contracts.project_id` to a PROJECT unit, but `org_units` (`20260709000200:33-53`) has **no** value/estimate column. Only the *contract* value exists — no pre-tender project estimate. |
| A2 Administrative sanction (who/when/amount) | ❌ | No `sanction*` table/column in any migration. `contracts` has `created_by`/`awarded_by` only (`:197-201`). |

## B. Tender notice
| Item | Status | Evidence |
|---|---|---|
| B1 Publishable notice (scope, est. value, period, criteria, EMD, key dates) | ❌ | No tender/notice table anywhere. `contracts` holds only `code,title,value_paise,status` (`:192-196`). No dates/EMD/criteria. |
| B2 Public/contractor notice board of open tenders | 🟡 | `contracts_read` RLS lets APPROVED contractors see FLOATED contracts (`:703-716`) → `bff.mjs:3368` → `ContractsPage.tsx`. But it's login-gated, lists *contracts* not *notices*, and mixes open+awarded (client toggle `:101`). No public board. |
| B3 Corrigendum (amend dates/details + history) | ❌ | No `corrigend*` anywhere. |

## C. Contractor eligibility
| Item | Status | Evidence |
|---|---|---|
| C1 Registration: GST, PAN, documents | ✅ | `contractors.gstin/pan` (`:120-125`), `contractor_documents` (`:160-177`), `ContractorRegistration.tsx`, `bff.mjs:3215-3313`. |
| C2 Experience records (past works, values, completion certs) | ❌ | No experience/past-works child table. |
| C3 Machinery list & key engineers/qualifications | ❌ | No machinery/equipment or key-personnel child tables. |
| C4 Department registration class/grade | ✅ | `contractors.licence_class` (`:124`, "PWD class I/II/III") + `licence_no`; UI `ContractorRegistration.tsx:182-187`. |

## D. Bidding — two envelopes (on `contract_bids`)
| Item | Status | Evidence |
|---|---|---|
| D1 EMD per bid (amount, mode, ref, refund/forfeit) | ❌ | `contract_bids` (`:231-238`) is amount-only. No EMD columns. |
| D2 Technical bid: structured criteria responses + attachments | ❌ | Bid row is amount-only; no technical/attachment table. `contractor_documents` is one-time KYC, not per-bid. |
| D3 Financial bid amount | ✅ | `contract_bids.amount_paise` (`:235`), written by `bff.mjs:3403-3410`. |
| **D4 Financial bids hidden until qualified + opening time** | ❌ | **`contract_bids_officer_read` (`:738-743`) lets any `contract.award` holder read `amount_paise` at any time — while still FLOATED, no close/qualification gate. Amounts are fully open to officers.** Confidentiality gap. |
| D5 Bid deadline enforcement (no late bids) | ❌ | No `bid_close_at` on contracts/`contract_bids`; BFF checks only `status='FLOATED'` (`bff.mjs:3407`), toggled manually. |

## E. Evaluation & award
| Item | Status | Evidence |
|---|---|---|
| E1 Technical qualify/disqualify + reason | ❌ | No evaluation table/columns for `contract_bids`. |
| E2 Financial opening restricted to qualified bidders | ❌ | No qualification concept; officers see all amounts immediately (D4). |
| E3 Automatic L1 among qualified | ❌ | No L1 computation; no contract-award function/endpoint (all `finalize_award` refs are the test-order path). |
| E4 Non-L1 award requires justification (constraint) | ❌ | No justification column/constraint. |
| E5 Award attribution (who/when) | ✅ | `contracts_award_attributed` constraint (`:203-206`) — but no controlled award path sets it (raw UPDATE under `contracts_manage`, `:718-725`). |

## F. Post-award
| Item | Status | Evidence |
|---|---|---|
| F1 LOA issuance record | ❌ | No LOA table/columns anywhere. |
| F2 Performance security (amount %, mode, validity, return) | ❌ | None. `contractor_payments` is material-payment holding, not a security instrument. |
| F3 Agreement signing record (date, number) | ❌ | No agreement table/columns. |

## G. Construction & quality
| Item | Status | Evidence |
|---|---|---|
| G1 BOQ per contract with stage + auto-test mapping | ✅ (DB only) | `boq_items` (`:245-264`): `stage_id`, `requires_test`, `test_id` + `boq_test_present` check. **No BFF route / no UI** — only in `seed-contracts.mjs`. |
| G2 Material delivery → auto-float test order | ✅ (DB only) | `record_material_delivery()` floats a `test_orders` row via `float_order()` (`:441-462`). **No BFF endpoint calls it — unreachable from the app.** |
| G3 Geofenced check-in, QR custody, results, certificates | ✅ | `check_in()` (`…001300:123-217`, `bff.mjs:907`), `chain_of_custody` (`:255-336`, `bff.mjs:963`), results/certs (`…001400`, `JobDetailPage`, `VerifyCertificatePage`). |
| G4 Engineer inspection/monitoring views | 🟡 | Test-quality: `QualityDashboardPage.tsx` + `gov/oversight/*`. **No** material-delivery / contractor-construction inspection view. |

## H. Payments & completion
| Item | Status | Evidence |
|---|---|---|
| H1 Test-vendor payment hold→release on certificate | ✅ | `payments` + `hold_payment()`/`release_payment()` gated on `signature_verified` (`…001400:353-435`). |
| H2 Contractor RA bills: measured qty vs BOQ → bill → approval → payment, cumulative cap | 🟡 | `contractor_payments` (`:327-340`) is a **flat `amount_paise` per delivery** (`unique(delivery_id)`) — no measured-quantity, no cumulative column, no per-BOQ-item cap. Measurement lives only on `material_deliveries.quantity_received`; `contract_budget` caps at whole-contract value, not per-item quantity. Not wired to BFF/UI. |
| H3 Final bill + project completion certificate | ❌ | No `completion_certificates`/final-bill flow anywhere. |

## Gap summary (what Part 2 must build)
**MISSING (17):** A2 sanction · B1 tender notice · B3 corrigendum · C2 experience · C3 machinery/engineers · D1 EMD · D2 technical bid · D4 bid-hiding RLS · D5 deadline · E1 technical eval · E2 opening restriction · E3 auto-L1 · E4 justification · F1 LOA · F2 performance security · F3 agreement · H3 completion cert.
**PARTIAL (4):** A1 project estimate · B2 public notice board · G4 construction inspection view · H2 measured RA bills.
**PRESENT-but-unreachable (2):** G1 BOQ, G2 delivery→auto-test — DB exists, no BFF/UI.

## Recommended build phasing (for the gap build)
The scope is far too large for one cycle. Suggested phases, each its own
spec → plan → build (all feeding the single `works_tender.sql` migration, added
incrementally, or one migration per phase):

1. **Notice & eligibility** — sanctions, tender_notices(+corrigenda), contractor experience/machinery/engineers; tender wizard + public/contractor tender board.
2. **Two-envelope bidding** — bid_emd, technical_bids, `contract_bids` deadline trigger + the DB-enforced financial-hiding RLS (D4) + late-bid trigger; contractor bid submission (EMD + technical + financial), my-bids status.
3. **Evaluation & award** — technical qualify/disqualify + reason, financial opening restricted to qualified, auto-L1, award-with-justification constraint, controlled award path; evaluation + financial-opening screens.
4. **Post-award & completion** — loa_records, performance_securities, agreements, LOA→security→agreement ordering trigger; ra_bills(+ra_bill_items measuring BOQ, cumulative cap trigger), completion_certificates; RA-bill approval + completion screens. Also wire up the existing BOQ/material-delivery DB (G1/G2) to BFF+UI.
