// Resolves and validates all environment-dependent config once, at boot.
// Pure: pass the env object in (process.env by default) so it is trivially
// testable without module-cache tricks.

const REQUIRED_IN_PROD = ['OTP_PEPPER', 'CORS_ORIGIN', 'SESSION_SECRET'];

export function loadConfig(rawEnv = process.env) {
  const isProd = rawEnv.EWORKS_ENV === 'production';
  const env = isProd ? 'production' : 'dev';

  if (isProd) {
    const missing = REQUIRED_IN_PROD.filter((k) => !rawEnv[k]);
    const hasDb =
      rawEnv.SUPABASE_DB_URL || rawEnv.DATABASE_URL || rawEnv.EWORKS_USE_LOCAL_PG === '1';
    if (!hasDb) missing.push('SUPABASE_DB_URL|DATABASE_URL|EWORKS_USE_LOCAL_PG');
    if (missing.length) {
      throw new Error(
        `refusing to start in production: missing required env: ${missing.join(', ')}`,
      );
    }
  }

  return Object.freeze({
    env,
    isProd,
    isDev: !isProd,
    port: Number(rawEnv.PORT || (isProd ? 3001 : 8787)),
    corsOrigin: rawEnv.CORS_ORIGIN || null,
    cookieSecure: isProd,
    otpPepper: rawEnv.OTP_PEPPER || 'dev-insecure-pepper',
    sessionSecret: rawEnv.SESSION_SECRET || 'dev-insecure-session-secret',
    msg91: Object.freeze({
      authKey: rawEnv.MSG91_AUTH_KEY || null,
      templateId: rawEnv.MSG91_TEMPLATE_ID || null,
      senderId: rawEnv.MSG91_SENDER_ID || null,
    }),
    otpTtlMs: Number(rawEnv.OTP_TTL_MS || 5 * 60 * 1000),
    otpMaxAttempts: Number(rawEnv.OTP_MAX_ATTEMPTS || 5),
    rateLimit: Object.freeze({
      windowMs: Number(rawEnv.OTP_RL_WINDOW_MS || 15 * 60 * 1000),
      maxPerPhone: Number(rawEnv.OTP_RL_MAX_PHONE || 5),
      maxPerIp: Number(rawEnv.OTP_RL_MAX_IP || 20),
    }),
    provider: rawEnv.OTP_PROVIDER || 'console',
    // Testing escape hatch: MFA_ENABLED=false skips the MFA step for everyone,
    // including government roles. Must be back on (unset or 'true') for real users.
    mfaEnabled: rawEnv.MFA_ENABLED !== 'false',
  });
}
