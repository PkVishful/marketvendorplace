// Dev-only data layer for the E-Works frontend.
//
// The E-Works backend does NOT use Supabase JWT auth. Row-level security is
// driven by two things the request must establish on the connection:
//   1. `set local role eworks_authenticated`  -- the RLS-guarded app role
//   2. `set_config('app.user_id', <uuid>, true)` -- read by eworks.current_user_id()
//
// A browser cannot speak raw Postgres, and there is no PostgREST/GoTrue in front
// of the local `eworks` database, so this tiny BFF is the ONLY correct way to
// exercise the real RLS locally. In production this same seam becomes the real
// BFF that maps an HTTP-only session cookie to the same two statements.
//
// Every query runs inside a transaction with `set local`, so the role and the
// user id never leak to the next borrower of a pooled connection.

import pg from 'pg';
import { loadEnv } from './load-env.mjs';

loadEnv();

const { Pool } = pg;

function createPool() {
  const useLocal = process.env.EWORKS_USE_LOCAL_PG === '1';
  const remoteUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (remoteUrl && !useLocal) {
    return new Pool({
      connectionString: remoteUrl,
      ssl: { rejectUnauthorized: false },
      max: 8,
    });
  }

  return new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5433),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'eworks',
    max: 8,
  });
}

export const pool = createPool();

// Run `fn(client)` as the RLS-guarded app identity. The role and app.user_id
// are set with `set local`, so they are scoped to this transaction only.
export async function withUserSession(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role eworks_authenticated');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** @deprecated use withUserSession */
export const withVendorSession = withUserSession;

const GOV_ROLES = new Set([
  'SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER',
  'SUPERINTENDING_ENGINEER', 'AUDITOR', 'HEAD_ADMIN',
]);

// Privileged reads used only to resolve a dev identity for the switcher. Never
// used to serve scoped data — that always goes through withUserSession.
export async function lookupProfile(userId) {
  const { rows: profiles } = await pool.query(
    `select id, phone, full_name as "fullName"
       from eworks.user_profiles where id = $1`,
    [userId],
  );
  const profile = profiles[0];
  if (!profile) return null;

  const { rows: roles } = await pool.query(
    `select ur.role_code as code,
            ou.name as "orgName",
            ou.level as "orgLevel",
            ou.path::text as "orgPath"
       from eworks.user_roles ur
       join eworks.org_units ou on ou.id = ur.org_unit_id
      where ur.user_id = $1
      order by ur.role_code`,
    [userId],
  );

  // Every permission the user holds at any active, unexpired role. This is the
  // "held anywhere" set the UI uses to show/hide tabs -- per-scope enforcement
  // still lives in RLS (eworks.has_permission), never in the client.
  const { rows: permRows } = await pool.query(
    `select distinct rp.permission_code as code
       from eworks.user_roles ur
       join eworks.role_permissions rp on rp.role_code = ur.role_code
       join eworks.org_units ou on ou.id = ur.org_unit_id
      where ur.user_id = $1
        and (ur.expires_at is null or ur.expires_at > now())
        and ou.is_active
      order by rp.permission_code`,
    [userId],
  );
  const permissions = permRows.map((r) => r.code);

  const { rows: vendors } = await pool.query(
    `select id, legal_name as "legalName", status as "vendorStatus"
       from eworks.vendors where owner_user_id = $1 limit 1`,
    [userId],
  );

  // Contracts module may not be migrated yet on every environment.
  // Login must not fail when eworks.contractors is missing.
  let contractors = [];
  try {
    const q = await pool.query(
      `select id, legal_name as "legalName", status as "contractorStatus"
         from eworks.contractors where owner_user_id = $1 limit 1`,
      [userId],
    );
    contractors = q.rows;
  } catch (err) {
    if (err?.code !== '42P01') throw err; // undefined_table only
  }

  const roleCodes = roles.map((r) => r.code);
  const portal = roleCodes.includes('LAB_VENDOR') || roleCodes.includes('FIELD_TECHNICIAN')
    ? 'vendor'
    : roleCodes.includes('CONTRACTOR')
      ? 'contractor'
      : roleCodes.some((c) => GOV_ROLES.has(c))
        ? 'gov'
        : 'unknown';

  return {
    ...profile,
    roles,
    permissions,
    portal,
    vendorId: vendors[0]?.id ?? null,
    vendorName: vendors[0]?.legalName ?? null,
    vendorStatus: vendors[0]?.vendorStatus ?? null,
    contractorId: contractors[0]?.id ?? null,
    contractorName: contractors[0]?.legalName ?? null,
    contractorStatus: contractors[0]?.contractorStatus ?? null,
  };
}
