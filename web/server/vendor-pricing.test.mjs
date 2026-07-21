// @vitest-environment node
// Route-level contract for the vendor rate-card endpoints, DB mocked.
// The real window arithmetic / RLS / bid-gate proofs live in
// vendor-pricing.db.test.mjs (needs the local Postgres) — this file pins the
// HTTP contract: status codes, validation, and response shapes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import { setSessionCookie } from './security.mjs';

// Mutable per-test fixture state consumed by the fake client below.
const state = {};

function resetState() {
  state.vendor = { id: 'vendor-a', status: 'APPROVED', orgPath: 'TN.COIMBATORE' };
  state.capability = true;
  state.inPast = false;
  state.newFrom = '2026-08-01';
  state.futureConflict = null;
  state.insertThrows = null;
  state.liveWindowClosed = 1;
  state.catalogRows = [];
  state.historyRows = [];
  state.govVendorVisible = true;
  state.govPricingRows = [];
  state.queries = [];
}

function fakeQuery(sql, params) {
  state.queries.push({ sql, params });
  if (sql.includes('from eworks.vendors v') && sql.includes('owner_user_id')) {
    return { rows: state.vendor ? [state.vendor] : [], rowCount: state.vendor ? 1 : 0 };
  }
  if (sql.includes('select 1 from eworks.vendor_test_capabilities')) {
    return { rows: [], rowCount: state.capability ? 1 : 0 };
  }
  if (sql.includes('coalesce($1::date')) {
    return { rows: [{ from: state.newFrom, inPast: state.inPast }], rowCount: 1 };
  }
  if (sql.includes('effective_from > $3::date')) {
    return { rows: state.futureConflict ? [state.futureConflict] : [], rowCount: state.futureConflict ? 1 : 0 };
  }
  if (sql.startsWith('update eworks.vendor_test_pricing')) {
    if (sql.includes('current_date') && !sql.includes('$3')) {
      // DELETE route's close-live-window update
      return state.liveWindowClosed
        ? { rows: [{ id: 'price-row-1', effectiveFrom: '2026-07-01' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [{ from: '2026-07-01' }], rowCount: state.liveWindowClosed };
  }
  if (sql.startsWith('insert into eworks.vendor_test_pricing')) {
    if (state.insertThrows) throw state.insertThrows;
    return {
      rows: [{ id: 'price-row-2', pricePaise: String(params[2]), effectiveFrom: state.newFrom, effectiveTo: null }],
      rowCount: 1,
    };
  }
  if (sql.includes('insert into eworks.audit_logs')) {
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes('from eworks.vendor_service_catalog')) {
    return { rows: state.catalogRows, rowCount: state.catalogRows.length };
  }
  if (sql.includes('not isempty(effective_range)')) {
    return { rows: state.historyRows, rowCount: state.historyRows.length };
  }
  if (sql.includes('select 1 from eworks.vendors where id')) {
    return { rows: [], rowCount: state.govVendorVisible ? 1 : 0 };
  }
  if (sql.includes('vendor_effective_price')) {
    return { rows: state.govPricingRows, rowCount: state.govPricingRows.length };
  }
  throw new Error(`fake client has no handler for: ${sql.slice(0, 80)}`);
}

vi.mock('./db.mjs', () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  withUserSession: vi.fn(async (_userId, fn) => fn({ query: async (sql, params) => fakeQuery(sql, params) })),
  lookupProfile: vi.fn(),
}));

const { createApp } = await import('./bff.mjs');

const config = loadConfig({});
const provider = { async send() { return { delivered: true }; } };

function cookieFor(userId) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  setSessionCookie(res, userId, config);
  return res.headers['Set-Cookie'].split(';')[0];
}

async function call(method, path, body) {
  const app = createApp(config, { provider });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.noAuth ? {} : { cookie: cookieFor('44444444-0000-0000-0000-00000000000a') }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => resetState());

describe('PUT /api/vendor/pricing/:testId — validation', () => {
  it('401 without a session', async () => {
    state.noAuth = true;
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 100 });
    state.noAuth = false;
    expect(r.status).toBe(401);
  });

  it.each([
    ['fractional paise', 1234.5],
    ['zero', 0],
    ['negative', -100],
    ['string', '1000'],
    ['missing', undefined],
  ])('400 on %s price', async (_label, pricePaise) => {
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_price');
  });

  it('400 on a malformed effectiveFrom', async () => {
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000, effectiveFrom: '01-08-2026' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_date');
  });

  it('400 when effectiveFrom is in the past (DB calendar decides)', async () => {
    state.inPast = true;
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000, effectiveFrom: '2020-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(/past/);
  });
});

describe('PUT /api/vendor/pricing/:testId — authorization', () => {
  it('403 when the caller has no vendor', async () => {
    state.vendor = null;
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000 });
    expect(r.status).toBe(403);
  });

  it('403 when the vendor is not APPROVED', async () => {
    state.vendor.status = 'SUBMITTED';
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000 });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/approved/i);
  });

  it('403 when there is no active capability for the test', async () => {
    state.capability = false;
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000 });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatch(/capability/);
  });
});

describe('PUT /api/vendor/pricing/:testId — window semantics', () => {
  it('409 names the conflicting future window and does not delete it', async () => {
    state.futureConflict = { from: '2026-09-01', to: null };
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000, effectiveFrom: '2026-08-01' });
    expect(r.status).toBe(409);
    expect(r.body.detail).toContain('2026-09-01');
    const deletes = state.queries.filter((q) => q.sql.startsWith('delete'));
    expect(deletes).toHaveLength(0);
  });

  it('409 when the exclusion constraint fires despite the pre-check (concurrent writer)', async () => {
    const exclusion = new Error('conflicting key value violates exclusion constraint');
    exclusion.code = '23P01';
    state.insertThrows = exclusion;
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 1000 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('price_window_conflict');
  });

  it('happy path closes the live window, inserts, audits, and returns integer paise', async () => {
    const r = await call('PUT', '/api/vendor/pricing/t1', { pricePaise: 125000, effectiveFrom: '2026-08-01' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      id: 'price-row-2', pricePaise: 125000, effectiveFrom: '2026-08-01', effectiveTo: null,
    });
    const audit = state.queries.find((q) => q.sql.includes('audit_logs'));
    expect(audit).toBeDefined();
    expect(audit.sql).toContain('vendor.price_set');
    const close = state.queries.find((q) => q.sql.startsWith('update eworks.vendor_test_pricing'));
    expect(close.sql).toContain('effective_range @>');
  });
});

describe('GET /api/vendor/pricing', () => {
  it('returns the catalog with bigint prices as numbers and unpriced rows as null', async () => {
    state.catalogRows = [
      { testId: 't1', testCode: 'CONCRETE_CUBE_STRENGTH', testName: 'Cube', requiresNabl: true, isQualifiedToday: true, currentPricePaise: '250000', effectiveFrom: '2026-07-01', effectiveTo: null, isPricedToday: true },
      { testId: 't2', testCode: 'CONCRETE_SLUMP', testName: 'Slump', requiresNabl: false, isQualifiedToday: true, currentPricePaise: null, effectiveFrom: null, effectiveTo: null, isPricedToday: false },
    ];
    const r = await call('GET', '/api/vendor/pricing');
    expect(r.status).toBe(200);
    expect(r.body[0].currentPricePaise).toBe(250000);
    expect(r.body[1].currentPricePaise).toBeNull();
  });
});

describe('GET /api/vendor/pricing/:testId/history', () => {
  it('returns windows newest-first with numeric paise', async () => {
    state.historyRows = [
      { pricePaise: '300000', effectiveFrom: '2026-08-01', effectiveTo: null },
      { pricePaise: '250000', effectiveFrom: '2026-07-01', effectiveTo: '2026-08-01' },
    ];
    const r = await call('GET', '/api/vendor/pricing/t1/history');
    expect(r.status).toBe(200);
    expect(r.body.map((w) => w.pricePaise)).toEqual([300000, 250000]);
  });
});

describe('DELETE /api/vendor/pricing/:testId', () => {
  it('404 when nothing is live', async () => {
    state.liveWindowClosed = 0;
    const r = await call('DELETE', '/api/vendor/pricing/t1');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('no_live_price');
  });

  it('closes the live window today and audits — never a hard delete', async () => {
    const r = await call('DELETE', '/api/vendor/pricing/t1');
    expect(r.status).toBe(200);
    expect(r.body.stopped).toBe(true);
    expect(state.queries.some((q) => q.sql.startsWith('delete from eworks.vendor_test_pricing'))).toBe(false);
    const audit = state.queries.find((q) => q.sql.includes('audit_logs'));
    expect(audit.sql).toContain('vendor.price_stop');
  });
});

describe('GET /api/gov/vendors/:id/pricing', () => {
  it('404 when the vendor is outside the officer scope (RLS-invisible)', async () => {
    state.govVendorVisible = false;
    const r = await call('GET', '/api/gov/vendors/v9/pricing');
    expect(r.status).toBe(404);
  });

  it('returns the read-only card with derived isPricedToday', async () => {
    state.govPricingRows = [
      { testId: 't1', testCode: 'CONCRETE_CUBE_STRENGTH', testName: 'Cube', requiresNabl: true, isQualifiedToday: true, currentPricePaise: '250000' },
      { testId: 't2', testCode: 'CONCRETE_SLUMP', testName: 'Slump', requiresNabl: false, isQualifiedToday: true, currentPricePaise: null },
    ];
    const r = await call('GET', '/api/gov/vendors/v1/pricing');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ currentPricePaise: 250000, isPricedToday: true });
    expect(r.body[1]).toMatchObject({ currentPricePaise: null, isPricedToday: false });
  });
});
