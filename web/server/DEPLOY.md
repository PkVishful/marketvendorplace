# BFF Deployment Guide

## pm2 Startup (Recommended)

Start the BFF under pm2 on system boot:

```bash
cd /home/deploy/marketvendorplace/web
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

This ensures the BFF restarts automatically if it crashes or the server reboots. The ecosystem config specifies fork mode with a single instance, which keeps the in-memory rate limiter and OTP store authoritative.

## Environment Configuration

All runtime secrets (SESSION_SECRET, MSG91_AUTH_KEY, PGPASSWORD, etc.) come from the server environment — **never** from `ecosystem.config.cjs` or checked into git. Use a root-owned `.env` file or systemd `EnvironmentFile=` (see below).

## Real-user prerequisites

Before accepting real users, set the following:

1. **SESSION_SECRET** (32+ random bytes) — Generate on the server, keep out of git. Example:
   ```bash
   openssl rand -base64 32
   ```

2. **OTP_PROVIDER=msg91** with credentials:
   - **MSG91_AUTH_KEY** — Your MSG91 authentication key
   - **MSG91_TEMPLATE_ID** — A TRAI-approved DLT template containing a variable (`var1`) for the OTP code
   - **MSG91_SENDER_ID** — Optional sender ID (usually embedded in the DLT template)

   The default console sink (`OTP_PROVIDER=console`) logs verification codes to stdout and is **staging-only**. Production must use `OTP_PROVIDER=msg91` (or another real SMS adapter). After switching, test the OTP flow end-to-end with a real phone number.

## Systemd Alternative

If you prefer not to use pm2, run the BFF under systemd with an environment file:

**File:** `/etc/systemd/system/eworks-bff.service`
```ini
[Unit]
Description=E-Works BFF
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/marketvendorplace/web
EnvironmentFile=/etc/eworks/bff.env
ExecStart=/usr/bin/node server/bff.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**File:** `/etc/eworks/bff.env` (root-owned, mode 0600)
```
EWORKS_ENV=production
PORT=3001
CORS_ORIGIN=https://marketplace.anvastech.in
SESSION_SECRET=<32+ random bytes>
OTP_PEPPER=<32+ random bytes>
OTP_PROVIDER=msg91
MSG91_AUTH_KEY=<key>
MSG91_TEMPLATE_ID=<dlt-template-id>
MSG91_SENDER_ID=<sender-id>
EWORKS_USE_LOCAL_PG=1
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=<actual password>
PGDATABASE=postgres
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable eworks-bff
sudo systemctl start eworks-bff
```

## Critical: Reverse Proxy Configuration

The frontend calls the BFF via **relative** `/api/*` paths. The static file server (e.g., Caddy serving `marketplace.anvastech.in`) **must** reverse-proxy `/api/*` to the BFF at `localhost:3001`.

**Caddy example:**
```
https://marketplace.anvastech.in {
  # Reverse-proxy all /api calls to the BFF
  reverse_proxy /api/* localhost:3001

  # Serve static frontend files
  file_server
}
```

**Nginx example:**
```nginx
server {
  listen 443 ssl;
  server_name marketplace.anvastech.in;

  location /api/ {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    root /path/to/frontend/dist;
    try_files $uri /index.html;
  }
}
```

**Without the `/api` reverse-proxy, all API calls will 404.**
