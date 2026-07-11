# Full Test Catalog & Stage Rules — Seed Design

*Turn the construction-testing catalog document into configurable seed data for the existing requirement-generation engine. Data only — no schema or engine changes.*

Date: 2026-07-11
Status: Design for review (domain-expert sign-off needed on the inventory)

---

## 1. Context — the engine already exists

`test_catalog`, `construction_stage`, `test_stage_rules`, `project_test_requirements`, and `eworks.generate_project_requirements(...)` are already built and match the document's "how this maps" section. This work only adds **rows**. Today: 12 tests, 9 stages, 6 rules. Target: the full document (~50 tests, ~80 rules), keeping the 9 coarse stages.

## 2. Engine contract the seed MUST satisfy

`compute_sample_count(frequency_type, frequency_spec, quantity)` interprets `frequency_spec`, so the seed's jsonb must fit these shapes exactly:

| frequency_type | Required `frequency_spec` | Sample count |
|---|---|---|
| `ONCE` | `{}` | always 1 |
| `PER_VOLUME` | `{ "unit":"m3", "tiers":[{"upto":N,"samples":k},…], "above":{"base_samples":b,"per_additional_m3":p,"add_samples":a} }` | tiered; **raises** past top tier if no `above` |
| `PER_STAGE` / `PER_LOT` / `PER_AREA` / `PER_LAYER` / `PER_HEAT` / `PER_CONSIGNMENT` | `{ "unit":"<key>", "samples":k }` (extra descriptive keys allowed) | `ceil(quantity) × k` |

`generate_project_requirements(project, stage_code, quantities, required_by)` requires `quantities` to contain each non-ONCE rule's `unit` key, else it raises. So **every distinct `unit` we introduce becomes a quantity the Planner must collect** (Section 6).

## 3. Conventions

- **Code:** `DOMAIN_TESTNAME`, UPPER_SNAKE (e.g. `SOIL_SPT`, `WELD_UT`). Existing 12 codes kept.
- **`requires_nabl`:** `true` for lab material tests (strength, chemical, gradation, tensile, weld UT/RT, tile absorption). `false` for site/functional tests (slump, efflorescence, visual weld, ponding, plaster, paint DFT, electrical megger/earth/continuity, plumbing, fire, HVAC) — these don't need NABL and shouldn't gate vendors on it.
- **`typical_tat_days`:** indicative (concrete cube 28-day → 30; quick field tests → 1–2; lab material → 5–7).
- **`acceptance_criteria`:** left `{}` (deferred to IS/QAP) except where the document/IS gives a crisp numeric (e.g. concrete grade, steel yield) — the engine snapshots it opaquely.
- **`is_code`:** taken verbatim from the document; `—` in the doc → null (to be set from the project QAP).
- **Idempotency:** additive migration, `insert … on conflict do nothing`. Existing 12 tests / 6 rules are untouched (see reconciliation, §7).
- **Stage mapping:** the doc's 13 timeline steps fold onto the 9 stages; per-pour/per-floor repetition is expressed by `PER_STAGE`/`PER_VOLUME` frequency, not by new stages.

## 4. Catalog inventory (test_catalog rows)

Legend — N = requires_nabl. `*` = already seeded (kept as-is).

### SOIL_GEOTECH
| code | name | IS | N | stage(s) |
|---|---|---|---|---|
| SOIL_SPT | SPT bore log | IS 2131 | ✓ | SITE_INVESTIGATION |
| SOIL_BEARING_CAPACITY* | Safe bearing capacity (plate load) | IS 1888 | ✓ | SITE_INVESTIGATION |
| SOIL_CLASSIFICATION | Classification, grain size, Atterberg | IS 2720 | ✓ | SITE_INVESTIGATION |
| SOIL_CHEMICAL | Sulphate / chloride / pH | IS 2720-27 | ✓ | SITE_INVESTIGATION |
| SOIL_CBR | California Bearing Ratio | IS 2720-16 | ✓ | SITE_INVESTIGATION |
| SOIL_COMPACTION_PROCTOR* | Compaction / Proctor (MDD/OMC) | IS 2720-7 | ✓ | EARTHWORK |
| SOIL_FIELD_DENSITY | Field density (core cutter / sand repl.) | IS 2720-28 | ✓ | EARTHWORK |
| PILE_INTEGRITY | Pile integrity (PIT) | IS 2911 | ✓ | FOUNDATION |
| PILE_LOAD | Pile load test | IS 2911 | ✓ | FOUNDATION |
| BENTONITE_SLURRY | Bentonite — density/viscosity/pH/sand | — | ✗ | FOUNDATION |
| ANTITERMITE_VERIFY | Anti-termite treatment verification | IS 6313 | ✗ | FOUNDATION |

### CONCRETE
| code | name | IS | N | stage(s) |
|---|---|---|---|---|
| CONCRETE_MIX_DESIGN* | Concrete mix design | IS 10262 | ✓ | SITE_INVESTIGATION |
| CONCRETE_SLUMP* | Slump / workability | IS 1199 | ✗ | FOUNDATION, SUBSTRUCTURE, SUPERSTRUCTURE |
| CONCRETE_CUBE_STRENGTH* | Cube compressive (7 & 28 d) | IS 516 | ✓ | FOUNDATION, SUBSTRUCTURE, SUPERSTRUCTURE |
| CONCRETE_CORE | Core extraction (on failure) | IS 516 | ✓ | SUPERSTRUCTURE |
| CONCRETE_NDT_REBOUND | Rebound hammer | IS 13311-2 | ✓ | SUPERSTRUCTURE |
| CONCRETE_NDT_UPV* | Ultrasonic pulse velocity | IS 13311-1 | ✓ | SUPERSTRUCTURE |
| CONCRETE_RCPT | RCPT / permeability | ASTM C1202 | ✓ | SUPERSTRUCTURE |

### CEMENT / AGGREGATE / WATER
| CEMENT_PHYSICAL* | Cement physical properties | IS 4031 | ✓ | FOUNDATION, SUPERSTRUCTURE |
| AGGREGATE_GRADING* | Grading & properties (sieve, sp.gr, absorption) | IS 2386 | ✓ | FOUNDATION |
| AGGREGATE_ABRASION | LA abrasion / impact / crushing | IS 2386-4 | ✓ | ROADWORK |
| AGGREGATE_FLAKINESS | Flakiness & elongation index | IS 2386-1 | ✓ | ROADWORK |
| WATER_QUALITY* | Water quality for construction | IS 456 | ✓ | SITE_INVESTIGATION |

### STEEL_REBAR (incl. welding/NDT)
| STEEL_TENSILE* | Rebar tensile / yield / bend / rebend / unit wt | IS 1786 | ✓ | SUBSTRUCTURE, SUPERSTRUCTURE |
| STEEL_CHEMICAL | Chemical composition (per heat) | IS 1786 | ✓ | SUBSTRUCTURE |
| STRUCTURAL_STEEL_SECTION | Structural section tests | IS 2062 | ✓ | SUPERSTRUCTURE |
| WELD_UT | Ultrasonic weld testing | IS 3664 | ✓ | SUPERSTRUCTURE |
| WELD_RT | Radiographic weld testing | IS 1182 | ✓ | SUPERSTRUCTURE |
| WELD_DPT | Dye penetrant | — | ✓ | SUPERSTRUCTURE |
| WELD_MPT | Magnetic particle | — | ✓ | SUPERSTRUCTURE |
| WELD_VISUAL | Visual weld inspection | — | ✗ | SUPERSTRUCTURE |

### MASONRY
| BRICK_COMPRESSIVE* | Brick compressive strength | IS 3495 | ✓ | MASONRY, SUBSTRUCTURE |
| BRICK_WATER_ABSORPTION | Brick water absorption | IS 3495 | ✓ | MASONRY |
| BRICK_EFFLORESCENCE | Efflorescence | IS 3495 | ✗ | MASONRY |
| AAC_BLOCK | AAC / concrete block strength & density | IS 2185 | ✓ | MASONRY |

### BITUMEN_ROAD
| BITUMEN_PENETRATION* | Penetration grade | IS 1203 | ✓ | ROADWORK |
| BITUMEN_SOFTENING | Softening point | IS 1205 | ✓ | ROADWORK |
| BITUMEN_DUCTILITY | Ductility | IS 1208 | ✓ | ROADWORK |
| BITUMEN_VISCOSITY | Viscosity | IS 1206 | ✓ | ROADWORK |
| BITUMEN_MARSHALL | Marshall stability (mix design) | MoRTH | ✓ | ROADWORK |
| BITUMEN_EXTRACTION | Bitumen content extraction | MoRTH | ✓ | ROADWORK |
| ROAD_LAYER_DENSITY | Field density — bituminous/GSB/WMM | MoRTH | ✓ | ROADWORK |

### WATERPROOFING_FINISHES
| WATERPROOF_PONDING | Ponding / flood test | — | ✗ | FINISHES |
| PLASTER_CHECK | Plaster thickness / adhesion | — | ✗ | FINISHES |
| TILE_ADHESION | Tile pull-off / adhesion | IS 15622 | ✓ | FINISHES |
| TILE_WATER_ABSORPTION | Tile water absorption | IS 13630 | ✓ | FINISHES |
| PAINT_DFT | Paint dry film thickness | — | ✗ | FINISHES |

### ELECTRICAL
| ELEC_INSULATION_RESISTANCE | Insulation resistance (megger) | IS 732 | ✗ | SERVICES |
| ELEC_EARTH_RESISTANCE | Earth resistance / earth pit | IS 3043 | ✗ | SERVICES |
| ELEC_FUNCTIONAL | Continuity / polarity / HV / RCD trip | IS 732 | ✗ | SERVICES |

### PLUMBING_FIRE_HVAC
| PLUMB_HYDROSTATIC | Hydrostatic pressure test | — | ✗ | SERVICES |
| PLUMB_DRAINAGE | Drainage / sewer leak / smoke | — | ✗ | SERVICES |
| FIRE_SYSTEM | Hydrant / sprinkler / alarm | — | ✗ | SERVICES |
| HVAC_TAB | Duct leakage / air balancing (TAB) | — | ✗ | SERVICES |

**Total: ~53 tests** (12 existing + ~41 new).

## 5. Stage rules (test_stage_rules) — frequency mapping

Document frequency → engine `frequency_type` + `unit`:

| Doc phrasing | frequency_type | unit |
|---|---|---|
| once per project/structure | `ONCE` | — |
| per borehole / stratum / stretch | `PER_LOT` | borehole / stratum / stretch |
| per borrow source / consignment / source | `PER_CONSIGNMENT` | borrow_source / consignment / source |
| per layer | `PER_LAYER` | layer |
| per pour / batch / laying day | `PER_STAGE` | pour / laying_day |
| per m³ (concrete cube) | `PER_VOLUME` | m3 (tiers) |
| per lot / heat | `PER_LOT` / `PER_HEAT` | lot / heat |
| per treated area / member / zone / circuit / earth_pit / system / line / pile / weld | `PER_AREA` or `PER_LOT` | (that unit) |

Each rule row: `(test, stage, frequency_type, frequency_spec, is_code, acceptance_criteria)`. Non-tiered specs are `{"unit":"…","samples":1}` unless the QAP implies more. `CONCRETE_CUBE_STRENGTH` reuses the existing IS 456 tiered spec at every concrete stage. Full rule list is generated in the migration (§ Implementation) — one row per (test, stage) pair in the tables above, ~80 rows.

## 6. New quantity vocabulary (Planner input)

The Planner must be able to supply these `quantities` keys when generating a stage's requirements: `m3, pour, layer, borehole, stratum, stretch, borrow_source, consignment, source, heat, lot, weld, member, treated_area, area, circuit, earth_pit, zone, line, system, laying_day, pile, proof_pile`. No schema change — they're jsonb keys. (Planner UI wiring is out of scope here; this seed just defines which units exist.)

## 7. Reconciliation notes (flag, don't silently overwrite)

- The existing `SOIL_COMPACTION_PROCTOR | EARTHWORK | PER_LAYER` rule conflates Proctor (once per borrow source) with field density (per layer). This seed adds `SOIL_FIELD_DENSITY | EARTHWORK | PER_LAYER` for the per-layer test and leaves the existing Proctor rule as-is (on-conflict-do-nothing). **Recommend** a follow-up to retype the Proctor rule to `PER_CONSIGNMENT unit borrow_source`; not done here to avoid mutating seeded data. Flagged for your call.
- Where the document shows `—` for IS code, the row's `is_code` is null and must be set from the project QAP before go-live.
- Frequencies are **indicative** per the document; they are data and editable per project/org via `resolve_stage_rule` overrides.

## 8. Definition of done

- Migration `supabase/migrations/20260711000100_test_catalog_full.sql` adds ~41 tests and ~80 rules, additive + idempotent.
- Applying it to local pg and running `generate_project_requirements` for a project across all 9 stages produces requirements with correct sample counts and no engine exceptions.
- `scripts/db-test.sh` still green; existing rows unchanged.
