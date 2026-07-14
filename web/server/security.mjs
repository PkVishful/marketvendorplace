// web/server/security.mjs
// CORS, cookie, rate-limit, and error-redaction concerns for the BFF.
// All environment differences are driven by the config object.

import cors from 'cors';
import { normalizePhone } from './auth.mjs';

const COOKIE = 'eworks_dev_uid';

export function cookieAttributes(config, { clear = false } = {}) {
  const parts = ['HttpOnly', 'Path=/', 'SameSite=Lax'];
  if (config.cookieSecure) parts.push('Secure');
  parts.push(`Max-Age=${clear ? 0 : 86400}`);
  return parts.join('; ');
}

export function setSessionCookie(res, uid, config) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(uid)}; ${cookieAttributes(config)}`);
}

export function clearSessionCookie(res, config) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttributes(config, { clear: true })}`);
}

export function readSessionCookie(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null;
}

export function corsMiddleware(config) {
  // Prod: only the frontend origin, with credentials. Dev: reflect (Vite proxy
  // is same-origin, but reflecting keeps direct-origin testing simple).
  return cors({
    origin: config.isProd ? config.corsOrigin : true,
    credentials: true,
  });
}

export function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> { count, resetAt }
  let lastSweep = Date.now();
  function rateLimiter(req, res, next) {
    const now = Date.now();
    // Lazily evict expired entries at most once per window, so long-running
    // processes don't accumulate one Map entry per distinct key forever.
    if (now - lastSweep > windowMs) {
      for (const [key, entry] of hits) {
        if (entry.resetAt < now) hits.delete(key);
      }
      lastSweep = now;
    }
    const k = keyFn(req);
    if (k == null) return next();
    let entry = hits.get(k);
    if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + windowMs }; hits.set(k, entry); }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    return next();
  }
  // Test-only introspection: number of keys currently resident in the
  // internal hit-tracking map. Not part of the public middleware contract.
  rateLimiter._size = () => hits.size;
  return rateLimiter;
}

// Key helpers for the OTP endpoints.
export const ipKey = (req) => `ip:${req.ip}`;
export const phoneKey = (req) => {
  const n = normalizePhone(req.body?.phone);
  return n ? `phone:${n}` : null;
};

export function redactErrorDetailMiddleware(config) {
  return function redactErrorDetail(req, res, next) {
    if (!config.isProd) return next();
    const orig = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 && body && typeof body === 'object' && 'detail' in body) {
        const { detail, ...rest } = body;
        return orig(rest);
      }
      return orig(body);
    };
    return next();
  };
}
