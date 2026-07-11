# E-Works Testing Marketplace — Full Frontend Build Prompt

*Every role, every page, the full org hierarchy, geolocation + QR flows, in a modern Tamil Nadu government theme. Companion to the master build prompt, the frontend implementation plan, and the notification-feed slice.*

---

## 0. Scope and guardrails

- Build only in the `web/` folder. Do not touch `supabase/`, migrations, or backend files.
- **No tokens in JS/localStorage** — session is an HTTP-only cookie via the BFF. React permission checks are UX only; Supabase RLS is the real gate.
- **Bilingual from day one:** Tamil + English, every string via i18n, language toggle persisted. Tamil is a first-class language, not an afterthought.
- **Accessibility & compliance:** target WCAG 2.1 AA and GIGW (Guidelines for Indian Government Websites) — keyboard navigable, screen-reader labels, colour never the sole signal, min 44px touch targets.
- Mobile-first for vendor + field; desktop-first for officer/admin. Every page responsive.

---

## 1. Design theme — "TN Government Modern"

> A proposed institutional government theme. Adjust the exact hues to match the official Tamil Nadu emblem/branding; keep the structure, contrast, and bilingual typography.

### Colour tokens (CSS variables / Tailwind config)

```
/* Brand */
--brand:        #1A3A6B;  /* deep government blue — primary actions, header */
--brand-dark:   #12294D;  /* hover/pressed */
--brand-tint:   #E9EFF8;  /* selected rows, chips, subtle fills */
--accent:       #E0A02D;  /* saffron/gold — highlights, active nav, seals */
--accent-dark:  #B67F16;

/* Neutrals */
--ink:          #1C2430;  /* primary text */
--slate:        #55617A;  /* secondary text */
--line:         #E2E6ED;  /* borders/dividers */
--surface:      #FFFFFF;  /* cards */
--bg:           #F5F7FA;  /* app background */

/* Status (WCAG-AA on white) */
--success:      #1E8E5A;  --success-bg: #E6F4EC;
--warning:      #B9770A;  --warning-bg: #FBF1DD;
--danger:       #C0392B;  --danger-bg:  #FBEAE8;
--info:         #1A6FB0;  --info-bg:    #E6F0F9;
```

Provide a dark-mode variant (invert surfaces/ink, keep brand/accent). Status colours must always pair with an icon or text label.

### Typography

- Latin UI: **Inter** or **Noto Sans**. Tamil: **Noto Sans Tamil** (or Mukta Malar). Set the font stack so Tamil glyphs render correctly everywhere: `"Inter","Noto Sans Tamil",system-ui,sans-serif`.
- Scale: page title 24/28, section 18/20, body 14/16, caption 12. Line-height generous for Tamil.

### Layout & components

- **Government header** on every page: TN state emblem (asset supplied) + department name in Tamil and English, org-scope breadcrumb, notification bell with unread badge, user menu, language toggle.
- Cards with `--line` borders, `radius: 12px`, subtle elevation. Data-dense tables for officers; large tappable cards for mobile.
- Clear focus rings (accent), skeleton loaders on every data screen, empty and error states everywhere.
- Footer: department, GIGW/accessibility statement, contact, last-updated.

---

## 2. Stack

Vite + React 18 + TS · Tailwind + shadcn/ui · TanStack Query · Zustand · React Router v6 · React Hook Form + Zod · react-i18next (en + ta) · Supabase JS via BFF · types generated from Supabase · Recharts (analytics) · MapLibre/Leaflet (maps) · `qrcode` + scanner · PWA + IndexedDB (field offline).

---

## 3. Organization hierarchy in the UI

`State → District → Division → Circle → Subdivision → Section → Field Unit → Project`. Every government page is scoped to a unit. Implement:

- An **org-scope selector / breadcrumb** in the header — a user works "within" a unit; the page's data is that unit's subtree (RLS enforces it server-side).
- A **hierarchy tree view** (admin) to browse/manage units.
- Scope drives dashboards: head admin sees State, district officer sees their District, site engineer sees their Section/Project.

---

## 4. Roles → portal → landing

| Role | Portal | Scope | Landing |
|---|---|---|---|
| Field technician | Field app (mobile PWA) | Assigned job | Today's jobs |
| Lab vendor owner | Vendor portal (mobile-first) | Own lab | Vendor dashboard |
| Site engineer (JE/AE) | Gov portal | Section/Project | My projects & tests |
| Executive engineer (EE) | Gov portal | Division | Division dashboard |
| Superintending eng. / district officer (SE) | Gov portal | Circle/District | District dashboard + vendor approvals |
| Auditor | Gov portal | Assigned | Audit dashboard (read-only) |
| Head admin (dept) | Gov portal | State | State overview + admin |
| Public/citizen | Public page (no login) | — | Certificate QR verify |

Nav is role-based: each role sees only the sections its permissions allow. Same portal shell, different menu.

---

## 5. Page inventory (all pages)

### Auth (all roles)
- Language select · Login (mobile + OTP) · MFA verify · Session-expired re-auth · Forgot/again OTP.

### Government portal

**Dashboards (role-specific widgets)**
- State overview (admin): districts, active projects, vendors, tests passed/pending/failed, alerts, map.
- District / Division dashboards: scoped versions.
- Site engineer home: my projects, pending tests, my floated orders, alerts.
- Auditor dashboard: recent actions, failed tests, certificate authenticity checks.

**Organization management (admin)**
- Districts: list + create/edit (State scope).
- Org-unit tree: browse + add/edit Division→Field Unit.
- Unit detail: staff, projects, activity.

**Users & roles (admin)**
- Users list (scoped) · Invite/create user → assign role + org-unit + validity window · Role & permission matrix · User detail (roles, sessions).

**Test catalog (admin)**
- Test catalog list + add/edit test type (domain, IS code, requires_nabl).
- Construction stages management.
- **Stage-rule editor** — configurable "when/how often" per test (ONCE/PER_STAGE/PER_VOLUME…); never hardcoded.
- Bulk import catalog.

**Vendor management (officer/admin)**
- Vendor approval queue (pending).
- Vendor detail — view every KYC document as an image, approve/reject per document + overall, trigger "verified" notification.
- Vendor directory (verified/suspended) + **map view** by service radius.
- Vendor performance & ratings.

**Projects & requirements**
- Projects list (scoped) · Register project (volume, steel tonnage, foundation) · Project detail (stages, tests, certificates, quality) · **Testing calendar / requirement planner** (auto-generated) · Requirement detail.

**Orders & bidding**
- Float-order builder (sealed RFQ from a requirement) · Order board (kanban/list by status) · Order detail · **Bid comparison + award** (sealed bids open at close, L1 among qualified) · Award confirmation.

**Certificates & quality**
- Certificate review/verify · Certificate vault (per project) · **Quality dashboard** (milestones green/amber/red) · **Escalation detail** (failed test → core/NDT/structural sign-off, next-floor block).

**Payments (finance/officer)**
- Payment queue (held-until-certificate) · Treasury/PFMS release + GST invoice · Payment history.

**Audit (auditor/admin)**
- Immutable audit-log viewer (filter user/action/resource/time) · Certificate authenticity verify (QR/hash).

**Reports & analytics**
- Reports (by district/vendor/test) · Analytics charts · Export CSV/PDF.

**Settings (all)**
- Profile · Language · Notification preferences · Security (MFA, active sessions/devices).

### Vendor portal (mobile-first; bottom nav: Orders / Bids / Jobs / Earnings / Profile)
- **KYC onboarding wizard** (multi-step): company details → addresses + GPS → tax IDs (GST/PAN) → accreditation (NABL/PWD + expiry) → document uploads (PAN co./proprietor, GST, registration, address proof, ID + selfie, bank) → capabilities selection → review & submit.
- KYC status / resubmit-on-reject.
- Vendor dashboard (summary, alerts, accreditation-expiry warnings).
- Capabilities manager (select tests from master list).
- Pricing manager (price per test, min qty, turnaround).
- Live orders feed (nearby; filter distance/type/milestone).
- Order detail (technical requirements).
- **Sealed bid sheet** (price + turnaround only; cannot see competitors).
- My bids (submitted/shortlisted/won/lost).
- Jobs (awarded) list + detail.
- Certificate upload / result entry (load kN → strength N/mm²; signed PDF).
- Certificate vault (own).
- Earnings (paid/pending, invoices).
- Profile & documents (renew accreditation).
- Notification feed.

### Field app (mobile PWA, offline-tolerant)
- Login (OTP) · Today's assigned jobs · Job detail · **Geo-fenced check-in** · **QR generate + bind** · **QR scan** · Sample details entry · Seal & confirm pickup · Day-7/28 result entry · Offline queue / sync status.

### Public (no login)
- Certificate QR verification page (scan/enter code → authentic/valid + issuing lab + date).

---

## 6. Key flows (detailed)

### Geolocation flow
1. On check-in, request the browser Geolocation permission; if denied, block with a clear message (can't sample without location).
2. Capture GPS + timestamp + a site photo + device id.
3. Compare position to the project's site geo-fence (radius); **server re-verifies** — never trust the client alone.
4. Inside fence → proceed; outside → block with "you must be on site."
5. Offline: store the check-in locally (IndexedDB), show "pending sync," verify on reconnect.
6. Show a small map with the site marker and the technician's position.

### QR-code flow (native serialized, chain-of-custody)
1. At sampling, the app requests **server-issued unique serialized QR ids** for each cube/sample, bound to the job + milestone.
2. Display + printable strips; the technician embeds them in the wet cubes.
3. The technician **scans each QR** to confirm binding — each scan writes a chain-of-custody entry (QR + geo + time + hash).
4. At the lab on day 7/28, **scan the QR** to pull the exact cube/milestone, enter the result; the certificate references the QR ids.
5. Officer/public **scan to verify** authenticity (hash match) — the public page needs no login.

### Sealed bidding flow (UI states)
Floated → Bidding open (vendor sees requirements, submits/edits a sealed price, never sees others) → Closed (locked at deadline) → Auto-opened + L1 among qualified awarded → Awarded (winner notified; others see "not selected"). Expired-accreditation vendors are auto-blocked from bidding.

### Escalation flow
28-day FAIL → red alert to site engineer / PM / structural consultant → next-floor "blocked" flag on the project → core/NDT test ordered → structural sign-off → milestone resolved or rework. Construction proceeds provisionally on the 7-day result; only a 28-day FAIL escalates.

---

## 7. Cross-cutting

- **Responsive:** vendor/field mobile-first; officer desktop-first; test both breakpoints.
- **Offline (field):** PWA service worker + IndexedDB queue for check-in, QR binds, and result entry; sync with conflict-safe retries; visible offline banner.
- **Performance:** route-level code splitting per portal; virtualize long lists (order board, audit log); compress images before upload; each list screen maps to one indexed backend query (order board → partial index, vendor search → PostGIS).
- **i18n:** en + ta resource files; no hardcoded strings; language toggle persisted; Tamil-safe layouts (longer strings).
- **Testing:** Vitest + RTL for logic/components; Playwright e2e for the two critical flows (vendor bid → award; field check-in → certificate).
- **Deployment:** `vite build` → CDN; env per stage; preview deploys per PR.

---

## 8. Build order

1. **Scaffold + theme + design-system components** (header with emblem, org-scope breadcrumb, status pill, badge, skeletons) + i18n + auth client.
2. **Notification feed** (first real slice — proves auth + RLS + data path).
3. **Vendor KYC wizard + admin approval queue** (forms, file upload, approve → notify).
4. **Requirement planner → float order → sealed bid → award** (the core marketplace loop).
5. **Field app** (geo check-in + QR + offline) → certificate upload → quality dashboard + escalation.
6. **Payments, audit viewer, reports/analytics, public QR verify.**

Build the theme and shared components first; every later page reuses them, so the rest is composition, not reinvention.
