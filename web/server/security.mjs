// web/server/security.mjs
// CORS, cookie, rate-limit, and error-redaction concerns for the BFF.
// All environment differences are driven by the config object.

import cors from 'cors';
import crypto from 'node:crypto';
import { normalizePhone } from './auth.mjs';

const COOKIE = 'eworks_dev_uid';
const SESSION_MAX_AGE_S = 86400; // 24h

function signSession(uid, expiresTs, secret) {
  return crypto.createHmac('sha256', secret).update(`${uid}.${expiresTs}`).digest('base64url');
}

export function cookieAttributes(config, { clear = false } = {}) {
  const parts = ['HttpOnly', 'Path=/', 'SameSite=Lax'];
  if (config.cookieSecure) parts.push('Secure');
  parts.push(`Max-Age=${clear ? 0 : SESSION_MAX_AGE_S}`);
  return parts.join('; ');
}

export function setSessionCookie(res, uid, config) {
  const expiresTs = Date.now() + SESSION_MAX_AGE_S * 1000;
  const value = `${uid}.${expiresTs}.${signSession(uid, expiresTs, config.sessionSecret)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; ${cookieAttributes(config)}`);
}

export function clearSessionCookie(res, config) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttributes(config, { clear: true })}`);
}

export function readSessionCookie(req, config) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  if (!hit) return null;
  const value = decodeURIComponent(hit.slice(COOKIE.length + 1));
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [uid, expiresStr, sig] = parts;
  const expiresTs = Number(expiresStr);
  if (!Number.isFinite(expiresTs) || Date.now() > expiresTs) return null;
  const expected = signSession(uid, expiresTs, config.sessionSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return uid;
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
    // Intentionally runs before the null-key short-circuit below, so the sweep
    // (and its memory bound) still fires even for requests whose keyFn yields
    // no key (e.g. an unparsable phone).
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

// 4-arg Express error handler: catches errors forwarded by Express (incl. rejected
// async handlers) so stack traces never reach the client. Detail only outside prod.
export function errorHandler(config) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const body = { error: 'internal_error' };
    if (!config.isProd) body.detail = err?.message;
    res.status(500).json(body);
  };
}

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
