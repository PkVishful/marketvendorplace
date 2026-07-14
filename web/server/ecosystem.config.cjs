// web/server/ecosystem.config.cjs
// Run the BFF under pm2 in fork mode (single instance so the in-memory rate
// limiter and OTP store are authoritative). All secrets come from the server
// environment — never from this file.
module.exports = {
  apps: [{
    name: 'bff',
    script: 'server/bff.mjs',
    cwd: '/home/deploy/marketvendorplace/web',
    exec_mode: 'fork',
    instances: 1,
    env: { EWORKS_ENV: 'production' },
    max_restarts: 10,
    restart_delay: 2000,
  }],
};
