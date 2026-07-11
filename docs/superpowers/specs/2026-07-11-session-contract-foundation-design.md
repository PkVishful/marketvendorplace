# Session Contract Foundation (Phase 1)

*Login & Dashboard flows — foundation slice. Make `/me` carry the differentiators the whole app design hangs on, and rewire tab/routing logic to read from them, without changing what any current user sees.*

Date: 2026-07-11
Status: Approved design, pre-implementation

---

## 1. Problem

The committed frontend is substantially built and secure — RLS enforces all scoping server-side. But the login/dashboard spec's central thesis is unmet: the app is meant to *differentiate inside* from a single `/me` call (engineers by **org level + permissions**, vendors by **status**), "never by hardcoded role names." Today every tab, dashboard, and route decision keys off hardcoded role-code arrays, and `/me` doesn't carry `org_level`, scope `path`, `permissions[]`, or `vendor_status`.

The database already models everything needed:
- `eworks.org_level` enum `STATE → DISTRICT → DIVISION → CIRCLE → SUBDIVISION → SECTION` (Circle is **below** Division — resolves the spec's open question), with `org_units(level, path ltree, parent_id)`.
- `eworks.permissions(code)`, `role_permissions(role_code, permission_code)`, `user_roles(user_id, role_code, org_unit_id, expires_at)` — permissions are scoped to an org subtree.
- `vendors.status` enum `DRAFT/SUBMITTED/APPROVED/REJECTED/SUSPENDED`.

So Phase 1 is a data-plumbing + mechanism slice, no schema changes.

## 2. Scope

**In:** enrich `/me`; add session types, selectors, and a `PermissionGate`; rewire nav derivation to permissions. No visible change to existing users' tabs.

**Out (later phases):** per-level dashboards & rollups (P2), clickable org drill-down (P2), the 5 missing gov tabs — Projects/Payments/Users & Roles/Test Catalog/Settings (P2), vendor status-mode routing & SUSPENDED/REJECTED surfaces (P3), KYC RHF+Zod + Supabase Storage signed-URL uploads (P4), bidding client pre-checks + accreditation-expiry warnings (P5).

**Guardrails:** all reads stay on the BFF (sets `app.user_id`; anon client will not read `eworks`). React permission/level/status checks are UX only; **RLS is the real gate.**

## 3. Design

### 3.1 Backend — `web/server/db.mjs` `lookupProfile(userId)`

Additive changes only; `sessionDto` spreads the profile, so new fields flow through `/api/me` automatically.

- **roles query:** add `ou.level AS "orgLevel"`, `ou.path::text AS "orgPath"` to the existing `user_roles ⋈ org_units` select.
- **permissions (new query):** union of codes held at any active role —
  ```sql
  select distinct rp.permission_code
    from eworks.user_roles ur
    join eworks.role_permissions rp on rp.role_code = ur.role_code
    join eworks.org_units ou on ou.id = ur.org_unit_id
   where ur.user_id = $1
     and (ur.expires_at is null or ur.expires_at > now())
     and ou.is_active
   order by 1;
  ```
  Returned as `permissions: string[]`. "Held anywhere" is the correct granularity for tab visibility; per-scope enforcement stays in RLS.
- **vendors query:** add `status AS "vendorStatus"`; surface `vendorStatus` at the top level (null when the user is not a vendor).

### 3.2 Types — `web/src/types/domain.ts`
```ts
export type OrgLevel = 'STATE'|'DISTRICT'|'DIVISION'|'CIRCLE'|'SUBDIVISION'|'SECTION';
export type VendorStatus = 'DRAFT'|'SUBMITTED'|'APPROVED'|'REJECTED'|'SUSPENDED';

export interface UserRole { code: string; orgName: string; orgLevel: OrgLevel; orgPath: string; }
export interface Session { /* …existing… */ permissions?: string[]; vendorStatus?: VendorStatus | null; }
```
`ORG_LEVELS` array (enum order) exported for ordinal math.

### 3.3 Selectors — new `web/src/auth/permissions.ts`
Pure functions + thin hooks over the `['me']` query:
- `hasPermission(session, perm): boolean`
- `usePermission(perm): boolean`
- `orgLevelOrdinal(level): number` (index into `ORG_LEVELS`)
- `primaryOrgLevel(session): OrgLevel | undefined` — shallowest (highest-authority) level among the user's roles
- `primaryOrgPath(session): string | undefined` — path of that primary role
- `vendorStatusOf(session): VendorStatus | null`

### 3.4 `PermissionGate` — new `web/src/components/PermissionGate.tsx`
```tsx
<PermissionGate perm="vendor.approve" fallback={null}>…</PermissionGate>
```
Renders children only when the session holds `perm` (any-of if given an array). Header comment states plainly: **UX only — RLS is the real gate.**

### 3.5 Nav derivation — `web/src/lib/navConfig.ts`
- `NavItem.roles?: string[]` → `NavItem.requiresPermission?: string | string[]` (any-of; absent ⇒ always shown).
- `govNavForSession` filters by `hasPermission` union instead of role codes; the `HEAD_ADMIN` short-circuit is removed (it holds the mapped perms).
- Approved tab → permission mapping:

  | Tab | Reveal when user holds |
  |---|---|
  | Dashboard | *(always)* |
  | Planner / Testing | `order.float` or `order.read` |
  | Orders & Bids | `order.read` |
  | Vendors | `vendor.read` or `vendor.approve` |
  | Certificates & Quality | `result.verify` or `order.read` |
  | Ratings | `vendor.read` |
  | Analytics / Reports | `order.read` |
  | Audit | `audit.read` or `audit.read_all` |

- Vendor nav keeps the existing `FIELD_TECHNICIAN`/`LAB_VENDOR` split for now (status-mode routing is P3).

## 4. Testing (TDD — tests first)

- **BFF `/me`** (exercised against local pg on `127.0.0.1:5433`): for a seeded engineer, `permissions[]` matches the seeded `role_permissions` union and each role carries `orgLevel`/`orgPath`; for a seeded vendor, `vendorStatus` is present and `permissions[]` includes `bid.submit`.
- **navConfig** (unit): dual-role user sees the union; a delegated permission reveals its tab; a user with no mapped permission does not see the tab; Dashboard always present.
- **PermissionGate** (unit): renders children when held, fallback when not, any-of array semantics.

## 5. Definition of done

- `/api/me` returns `permissions[]`, `vendorStatus`, and per-role `orgLevel`/`orgPath`; verified end-to-end against a real seeded user.
- `navConfig` derives gov tabs from `permissions[]`; **existing users see exactly the same tabs as before** (regression-checked against the seed).
- `PermissionGate` + selectors exist with tests; `npm run test` green; `npm run build` succeeds.
- No schema changes; BFF remains the only `eworks` data path.

## 6. Risks / notes

- `SUPERINTENDING_ENGINEER` appears in nav but has **no** seeded `role_permissions`. Under the new mapping such a user would see only Dashboard. This is faithful to the data (they hold no permissions) and is a **seed gap to raise**, not a Phase 1 regression to paper over. Flag to the team; do not invent grants here.
- Multi-role users: `primaryOrgLevel` picks the shallowest level; documented so P2 dashboards build on a defined rule.
- `permissions[]` is "held anywhere," so the UI may show a tab whose action RLS later denies at a specific scope — acceptable (UX only), and the eventual action still fails closed server-side.
