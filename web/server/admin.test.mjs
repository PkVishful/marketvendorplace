// @vitest-environment node
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { httpError, registerAdminRoutes } from './admin.mjs';

describe('admin helpers', () => {
  it('httpError carries status and code', () => {
    const e = httpError(403, 'nope', 'forbidden');
    expect(e.httpStatus).toBe(403);
    expect(e.errorCode).toBe('forbidden');
  });
});

describe('admin routes', () => {
  it('GET /api/admin/users requires auth', async () => {
    const app = express();
    app.use(express.json());
    registerAdminRoutes(app, {
      requireUser: (_req, res) => {
        res.status(401).json({ error: 'not_authenticated' });
        return null;
      },
      withUserSession: vi.fn(),
    });
    const srv = app.listen(0);
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/users`);
    srv.close();
    expect(r.status).toBe(401);
  });
});
