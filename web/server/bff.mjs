// Dev BFF for the E-Works frontend.
//
// Purpose: hold the session in an HTTP-only cookie (never in JS) and translate
// it, per request, into the `eworks_authenticated` role + `app.user_id` GUC
// that the backend's RLS reads.

import express from 'express';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { registerAdminRoutes } from './admin.mjs';
import { withUserSession, lookupProfile, pool } from './db.mjs';
import {
  buildSession, findUserIdByPhone, issueChallenge, userRequiresMfa, verifyChallenge,
} from './auth.mjs';
import { saveKycDocument, readKycDocument } from './kyc-upload.mjs';
import { saveContractorDocument, readContractorDocument } from './kyc-upload.mjs';
import { saveCheckinPhoto, readCheckinPhoto, sniffImageType } from './checkin-photo.mjs';
import { saveCertificate, readCertificate } from './certificate-file.mjs';
import { loadConfig } from './env.mjs';
import { computeMilestoneHealth } from './region-health.mjs';
import { loadChildRegions } from './area-queries.mjs';
import { selectProvider } from './otp/provider.mjs';
import { shapeChecklist, deriveReqStatus } from './catalog.mjs';
import {
  corsMiddleware, setSessionCookie, clearSessionCookie, readSessionCookie,
  createRateLimiter, ipKey, phoneKey, redactErrorDetailMiddleware, errorHandler,
} from './security.mjs';

const KYC_DOC_TYPES = [
  'GST_CERTIFICATE',
  'PAN_COMPANY',
  'NABL_CERTIFICATE',
  'NABL_SCOPE',
  'ADDRESS_PROOF',
  'ID_PROOF',
  'BANK_PROOF',
];

const KYC_REQUIRED_DOCS = ['GST_CERTIFICATE', 'PAN_COMPANY', 'NABL_CERTIFICATE', 'ADDRESS_PROOF', 'ID_PROOF'];

// Contractor KYC — mirrors the vendor set, minus accreditation (contractors are
// not labs). Matches the eworks.contractor_doc_type enum.
const CONTRACTOR_DOC_TYPES = ['PAN', 'GST_CERTIFICATE', 'LICENCE', 'ADDRESS_PROOF', 'ID_PROOF', 'BANK_PROOF'];
const CONTRACTOR_REQUIRED_DOCS = ['PAN', 'GST_CERTIFICATE', 'LICENCE', 'ID_PROOF', 'BANK_PROOF'];

function mapSampleRow(row) {
  return {
    id: row.id,
    qrCode: row.qrCode,
    specimenNo: row.specimenNo,
    testAgeDays: row.testAgeDays,
    testName: row.testName,
    receivedAtLab: row.receivedAtLab,
    result: row.resultId
      ? {
          id: row.resultId,
          metric: row.metric,
          metricValue: Number(row.metricValue),
          thresholdMin: row.thresholdMin != null ? Number(row.thresholdMin) : null,
          thresholdMax: row.thresholdMax != null ? Number(row.thresholdMax) : null,
          passed: row.passed,
          isProvisional: row.isProvisional,
          enteredAt: row.enteredAt,
        }
      : null,
  };
}

async function fetchFulfillment(client, orderId) {
  const jobQ = await client.query(
    `select id from eworks.test_jobs where order_id = $1`,
    [orderId],
  );
  const jobId = jobQ.rows[0]?.id ?? null;
  if (!jobId) {
    return {
      jobId: null,
      results: [],
      escalations: [],
      certificate: null,
      payment: null,
      canVerifyCertificate: false,
      canReleasePayment: false,
      resultsComplete: false,
    };
  }

  const resultsQ = await client.query(
    `select s.qr_code as "qrCode", tc.name as "testName", s.specimen_no as "specimenNo",
            s.test_age_days as "testAgeDays", r.metric, r.metric_value as "metricValue",
            r.passed, r.is_provisional as "isProvisional"
       from eworks.samples s
       join eworks.test_catalog tc on tc.id = s.test_id
       join eworks.test_results r on r.sample_id = s.id
      where s.job_id = $1
      order by s.specimen_no, s.test_age_days`,
    [jobId],
  );

  const escQ = await client.query(
    `select e.id, e.level, e.status, e.reason, e.raised_at as "raisedAt",
            s.qr_code as "qrCode", r.metric, r.metric_value as "metricValue"
       from eworks.escalations e
       join eworks.test_results r on r.id = e.result_id
       join eworks.samples s on s.id = r.sample_id
      where e.order_id = $1
      order by e.raised_at desc`,
    [orderId],
  );

  const certQ = await client.query(
    `select id, storage_path as "storagePath", signature_verified as "signatureVerified",
            signer_name as "signerName", verified_at as "verifiedAt", issued_at as "issuedAt"
       from eworks.certificates where job_id = $1`,
    [jobId],
  );

  const payQ = await client.query(
    `select id, status, amount_paise as "amountPaise", treasury_ref as "treasuryRef",
            gst_invoice_no as "gstInvoiceNo", released_at as "releasedAt"
       from eworks.payments where order_id = $1`,
    [orderId],
  );

  const permQ = await client.query(
    `select
       exists (
         select 1 from eworks.test_orders o
           join eworks.org_units ou on ou.id = o.org_unit_id
          where o.id = $1
            and eworks.has_permission('result.verify', ou.path)
       ) as "canVerifyCertificate",
       exists (
         select 1 from eworks.test_orders o
           join eworks.org_units ou on ou.id = o.org_unit_id
          where o.id = $1
            and eworks.has_permission('order.award', ou.path)
       ) as "canReleasePayment"`,
    [orderId],
  );

  const completeQ = await client.query(
    `select
       (select count(*)::int from eworks.samples s where s.job_id = $1) as total,
       (select count(*)::int from eworks.samples s
          join eworks.test_results r on r.sample_id = s.id
         where s.job_id = $1) as with_result`,
    [jobId],
  );
  const { total, with_result: withResult } = completeQ.rows[0];

  return {
    jobId,
    results: resultsQ.rows.map((r) => ({
      ...r,
      metricValue: Number(r.metricValue),
    })),
    escalations: escQ.rows.map((e) => ({
      ...e,
      metricValue: Number(e.metricValue),
    })),
    certificate: certQ.rows[0] ?? null,
    payment: payQ.rows[0] ?? null,
    canVerifyCertificate: permQ.rows[0].canVerifyCertificate,
    canReleasePayment: permQ.rows[0].canReleasePayment,
    resultsComplete: total > 0 && total === withResult,
  };
}

// Region health scoring lives in region-health.mjs so the area endpoint can
// share it without an import cycle. Re-exported here because these were part of
// this module's public surface before the extraction.
export { assembleRegions, scoreFromHealthCounts } from './region-health.mjs';

function computeVendorTier(row) {
  const passRate = Number(row.passRate);
  if (row.openEscalations > 0) return 'watch';
  if (row.jobsCompleted >= 1 && passRate >= 0.9) return 'excellent';
  if (row.jobsCompleted >= 1 || passRate >= 0.75) return 'good';
  if (row.awardsWon === 0) return 'new';
  return 'neutral';
}

// Shape returned to the browser — always `userId`, never raw `id`.
function sessionDto(profile) {
  const { id, ...rest } = profile;
  return { userId: id, ...rest };
}

export function createApp(config = loadConfig(), { provider = selectProvider(config) } = {}) {
  function requireUser(req, res) {
    const userId = readSessionCookie(req, config);
    if (!userId) { res.status(401).json({ error: 'not_authenticated' }); return null; }
    return userId;
  }
  const app = express();
  if (config.isProd) app.set('trust proxy', 1);
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '6mb' }));
  app.use(redactErrorDetailMiddleware(config));

  const otpIpLimiter = createRateLimiter({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.maxPerIp, keyFn: ipKey,
  });
  const otpPhoneLimiter = createRateLimiter({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.maxPerPhone, keyFn: phoneKey,
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // --- dev session -----------------------------------------------------------
  if (!config.isProd) {
    app.post('/api/dev/login', async (req, res) => {
      const { userId } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const profile = await lookupProfile(userId);
      if (!profile) return res.status(404).json({ error: 'unknown user' });
      setSessionCookie(res, userId, config);
      res.json(sessionDto(profile));
    });

    app.post('/api/dev/logout', (_req, res) => { clearSessionCookie(res, config); res.json({ ok: true }); });
  }

  // --- phone + OTP + MFA (production auth seam) -----------------------------
  app.post('/api/auth/otp/send', otpIpLimiter, otpPhoneLimiter, async (req, res) => {
    const { phone } = req.body || {};
    try {
      const userId = await findUserIdByPhone(pool, phone);
      if (!userId) return res.status(404).json({ error: 'unknown_phone' });
      const requiresMfa = config.mfaEnabled && await userRequiresMfa(pool, userId);
      const challenge = await issueChallenge({ phone, userId, requiresMfa, purpose: 'otp', config, provider });
      if (!challenge) return res.status(400).json({ error: 'invalid_phone' });
      const { demoCode, ...sendResult } = challenge;
      let demoMfa;
      if (requiresMfa) {
        const mfaChallenge = await issueChallenge({ phone, userId, requiresMfa, purpose: 'mfa', config, provider });
        demoMfa = mfaChallenge?.demoCode;
      }
      res.json({
        sent: true,
        ...sendResult,
        ...(config.demoMode ? { demoOtp: demoCode, ...(demoMfa ? { demoMfa } : {}) } : {}),
      });
    } catch (err) {
      res.status(500).json({ error: 'otp_send_failed', detail: err.message });
    }
  });

  app.post('/api/auth/otp/verify', otpIpLimiter, otpPhoneLimiter, async (req, res) => {
    const { phone, otp, mfaCode } = req.body || {};
    const otpResult = verifyChallenge({ phone, code: otp, purpose: 'otp', config });
    if (!otpResult.ok) return res.status(401).json({ error: 'invalid_otp', reason: otpResult.reason });
    const challenge = otpResult.challenge;
    if (challenge.requiresMfa) {
      const mfaResult = verifyChallenge({ phone, code: mfaCode, purpose: 'mfa', config });
      if (!mfaResult.ok) return res.status(401).json({ error: 'invalid_mfa', reason: mfaResult.reason });
    }
    try {
      const session = await buildSession(challenge.userId);
      if (!session) return res.status(404).json({ error: 'unknown_user' });
      setSessionCookie(res, challenge.userId, config);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: 'login_failed', detail: err.message });
    }
  });

  app.post('/api/auth/logout', (_req, res) => { clearSessionCookie(res, config); res.json({ ok: true }); });

  // --- public certificate verify (no session) --------------------------------
  app.get('/api/public/certificates/:id', async (req, res) => {
    try {
      const q = await pool.query(
        `select
           c.id,
           encode(c.sha256, 'hex') as "sha256Hex",
           c.signature_verified as "signatureVerified",
           c.signer_name as "signerName",
           c.verified_at as "verifiedAt",
           c.issued_at as "issuedAt",
           o.milestone,
           proj.name as "projectName",
           proj.code as "projectCode",
           v.legal_name as "labName",
           ou.name as "orgName"
         from eworks.certificates c
         join eworks.test_jobs j on j.id = c.job_id
         join eworks.test_orders o on o.id = j.order_id
         join eworks.org_units proj on proj.id = o.project_id
         join eworks.org_units ou on ou.id = o.org_unit_id
         join eworks.vendors v on v.id = j.vendor_id
        where c.id = $1`,
        [req.params.id],
      );
      if (q.rowCount === 0) return res.json({ found: false });
      res.json({ found: true, ...q.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/public/certificates/:id/file', async (req, res) => {
    try {
      const q = await pool.query(
        `select job_id as "jobId" from eworks.certificates where id = $1`,
        [req.params.id],
      );
      if (q.rowCount === 0) return res.status(404).json({ error: 'not_found' });
      const bytes = await readCertificate(q.rows[0].jobId);
      if (!bytes) return res.status(404).json({ error: 'no_certificate' });
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', 'inline; filename="certificate.pdf"');
      res.send(bytes);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/me', async (req, res) => {
    const userId = readSessionCookie(req, config);
    if (!userId) return res.status(401).json({ authenticated: false });
    const profile = await lookupProfile(userId);
    if (!profile) { clearSessionCookie(res, config); return res.status(401).json({ authenticated: false }); }
    res.json({ authenticated: true, ...sessionDto(profile) });
  });

  // --- notification feed (RLS-scoped) ----------------------------------------
  app.get('/api/notifications', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             n.id,
             n.created_at        as "createdAt",
             n.read_at           as "readAt",
             e.event_type        as "eventType",
             e.order_id          as "orderId",
             e.vendor_id         as "vendorId",
             (o.id is not null)  as "orderAlive",
             o.milestone         as "orderMilestone",
             o.status            as "orderStatus"
           from eworks.notifications n
           join eworks.notification_events e on e.id = n.event_id
           left join eworks.test_orders o on o.id = e.order_id
          order by n.created_at desc, n.id desc`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/notifications/:id/read', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const updated = await withUserSession(userId, async (client) => {
        const q = await client.query(
          'update eworks.notifications set read_at = now() where id = $1 and read_at is null',
          [req.params.id],
        );
        return q.rowCount;
      });
      res.json({ updated });
    } catch (err) {
      res.status(500).json({ error: 'update_failed', detail: err.message });
    }
  });

  // --- vendor order board (RLS-scoped) -----------------------------------------
  app.get('/api/vendor/orders', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             o.id,
             o.milestone,
             o.status,
             o.required_by       as "requiredBy",
             o.floated_at        as "floatedAt",
             o.bid_close_at      as "bidCloseAt",
             o.reveal_close_at   as "revealCloseAt",
             st_y(o.site::geometry) as lat,
             st_x(o.site::geometry) as lng,
             (select count(*)::int from eworks.order_items oi where oi.order_id = o.id) as "itemCount"
           from eworks.test_orders o
          where o.status in ('FLOATED', 'REVEALING')
          order by o.bid_close_at asc nulls last, o.floated_at desc`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/vendor/orders/:id', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await withUserSession(userId, async (client) => {
        const orderQ = await client.query(
          `select
             o.id,
             o.milestone,
             o.status,
             o.eval_method       as "evalMethod",
             o.required_by       as "requiredBy",
             o.floated_at        as "floatedAt",
             o.bid_close_at      as "bidCloseAt",
             o.reveal_close_at   as "revealCloseAt",
             st_y(o.site::geometry) as lat,
             st_x(o.site::geometry) as lng,
             ou.name             as "orgName"
           from eworks.test_orders o
           -- LEFT so a service-radius-eligible vendor in another district can
           -- still open the tender: org_units_read scopes the unit's name to the
           -- owning hierarchy, but the order itself is theirs to bid on. An inner
           -- join would drop the row and 404 the tender for cross-district labs.
           left join eworks.org_units ou on ou.id = o.org_unit_id
          where o.id = $1`,
          [req.params.id],
        );
        if (orderQ.rowCount === 0) return null;

        const itemsQ = await client.query(
          `select
             oi.id,
             oi.quantity,
             oi.test_ages_days   as "testAgesDays",
             tc.code             as "testCode",
             tc.name             as "testName",
             tc.requires_nabl    as "requiresNabl",
             tc.default_is_code  as "isCode"
           from eworks.order_items oi
           join eworks.test_catalog tc on tc.id = oi.test_id
          where oi.order_id = $1
          order by tc.name`,
          [req.params.id],
        );

        const bidQ = await client.query(
          `select
             b.id,
             b.status,
             b.committed_at        as "committedAt",
             b.revealed_price_paise as "revealedPricePaise",
             b.revealed_at         as "revealedAt"
           from eworks.order_bids b
           join eworks.vendors v on v.id = b.vendor_id
          where b.order_id = $1
            and v.owner_user_id = eworks.current_user_id()
          limit 1`,
          [req.params.id],
        );

        const jobQ = await client.query(
          `select j.id from eworks.test_jobs j
             join eworks.vendors v on v.id = j.vendor_id
            where j.order_id = $1 and v.owner_user_id = eworks.current_user_id()
            limit 1`,
          [req.params.id],
        );

        return {
          ...orderQ.rows[0],
          items: itemsQ.rows,
          myBid: bidQ.rows[0] ?? null,
          jobId: jobQ.rows[0]?.id ?? null,
        };
      });

      if (!result) return res.status(404).json({ error: 'order_not_found' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/orders/:id/bid/commit', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { commitment } = req.body || {};
    if (!commitment || typeof commitment !== 'string') {
      return res.status(400).json({ error: 'commitment_required' });
    }
    const bytes = Buffer.from(commitment, 'hex');
    if (bytes.length !== 32) {
      return res.status(400).json({ error: 'invalid_commitment' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, status, committed_at as "committedAt"
             from eworks.submit_bid_commitment($1, $2)`,
          [req.params.id, bytes],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'commit_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/orders/:id/bid/reveal', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { pricePaise, nonce } = req.body || {};
    if (!pricePaise || !nonce) {
      return res.status(400).json({ error: 'price_and_nonce_required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, status, revealed_price_paise as "revealedPricePaise", revealed_at as "revealedAt"
             from eworks.reveal_bid($1, $2, $3)`,
          [req.params.id, pricePaise, nonce],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'reveal_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/orders/:id/accept', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        try {
          const q = await client.query(
            `select id, status from eworks.assign_job($1)`,
            [req.params.id],
          );
          return q.rows[0];
        } catch (err) {
          // Already accepted (unique(order_id)) -> return the existing job so
          // the client can just route to it. Any other error propagates.
          if (err.code === '23505') {
            const existing = await client.query(
              `select id, status from eworks.test_jobs where order_id = $1`,
              [req.params.id],
            );
            if (existing.rowCount > 0) return existing.rows[0];
          }
          throw err;
        }
      });
      res.status(201).json({ jobId: row.id, status: row.status });
    } catch (err) {
      res.status(400).json({ error: 'accept_failed', detail: err.message });
    }
  });

  // --- vendor field jobs (RLS-scoped) ----------------------------------------
  app.get('/api/vendor/jobs', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const data = await withUserSession(userId, async (client) => {
        const jobsQ = await client.query(
          `select
             j.id,
             j.status,
             j.order_id      as "orderId",
             o.milestone,
             o.required_by   as "requiredBy",
             st_y(o.site::geometry) as lat,
             st_x(o.site::geometry) as lng,
             (select count(*)::int from eworks.samples s where s.job_id = j.id) as "sampleCount"
           from eworks.test_jobs j
           join eworks.test_orders o on o.id = j.order_id
          order by j.created_at desc`,
        );
        // Orders this vendor won but has not yet accepted into a job.
        // user_won_order() gates visibility to the winner only.
        const awaitingQ = await client.query(
          `select
             o.id            as "orderId",
             o.milestone,
             o.required_by   as "requiredBy"
           from eworks.test_orders o
          where o.status = 'AWARDED'
            and eworks.user_won_order(o.id)
            and not exists (select 1 from eworks.test_jobs j where j.order_id = o.id)
          order by o.required_by asc nulls last`,
        );
        return { jobs: jobsQ.rows, awaiting: awaitingQ.rows };
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/vendor/jobs/:id', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await withUserSession(userId, async (client) => {
        const jobQ = await client.query(
          `select
             j.id,
             j.status,
             j.device_id     as "deviceId",
             j.order_id      as "orderId",
             o.milestone,
             o.required_by   as "requiredBy",
             st_y(o.site::geometry) as lat,
             st_x(o.site::geometry) as lng,
             v.legal_name    as "vendorName"
           from eworks.test_jobs j
           join eworks.test_orders o on o.id = j.order_id
           -- LEFT JOIN: an assigned field technician can read the job (jobs_read)
           -- but not the vendor row (vendors_read is owner/officer-only). An inner
           -- join would drop the whole job for them; the job's visibility must be
           -- governed by jobs_read alone, with vendorName degrading to null.
           left join eworks.vendors v on v.id = j.vendor_id
          where j.id = $1`,
          [req.params.id],
        );
        if (jobQ.rowCount === 0) return null;

        const itemsQ = await client.query(
          `select oi.quantity, tc.code as "testCode", tc.name as "testName", oi.test_ages_days as "testAgesDays"
             from eworks.order_items oi
             join eworks.test_catalog tc on tc.id = oi.test_id
            where oi.order_id = $1`,
          [jobQ.rows[0].orderId],
        );

        const samplesQ = await client.query(
          `select s.id, s.qr_code as "qrCode", s.specimen_no as "specimenNo",
                  s.test_age_days as "testAgeDays", tc.name as "testName",
                  exists (
                    select 1 from eworks.chain_of_custody c
                     where c.sample_id = s.id and c.event = 'RECEIVED_AT_LAB'
                  ) as "receivedAtLab",
                  r.id as "resultId", r.metric, r.metric_value as "metricValue",
                  r.threshold_min as "thresholdMin", r.threshold_max as "thresholdMax",
                  r.passed, r.is_provisional as "isProvisional", r.entered_at as "enteredAt"
             from eworks.samples s
             join eworks.test_catalog tc on tc.id = s.test_id
             left join eworks.test_results r on r.sample_id = s.id
            where s.job_id = $1
            order by s.specimen_no, s.test_age_days`,
          [req.params.id],
        );

        const certQ = await client.query(
          `select id, storage_path as "storagePath", signature_verified as "signatureVerified",
                  signer_name as "signerName", verified_at as "verifiedAt", issued_at as "issuedAt"
             from eworks.certificates where job_id = $1`,
          [req.params.id],
        );

        const payQ = await client.query(
          `select p.id, p.status, p.amount_paise as "amountPaise", p.treasury_ref as "treasuryRef",
                  p.gst_invoice_no as "gstInvoiceNo", p.released_at as "releasedAt"
             from eworks.payments p
             join eworks.test_jobs j on j.order_id = p.order_id
            where j.id = $1`,
          [req.params.id],
        );

        const checkinQ = await client.query(
          `select distance_m as "distanceM", accuracy_m as "accuracyM", server_at as "serverAt"
             from eworks.site_checkins where job_id = $1`,
          [req.params.id],
        );

        const custodyQ = await client.query(
          `select c.event, c.occurred_at as "occurredAt", s.qr_code as "qrCode"
             from eworks.chain_of_custody c
             join eworks.samples s on s.id = c.sample_id
            where s.job_id = $1
            order by c.seq`,
          [req.params.id],
        );

        return {
          ...jobQ.rows[0],
          items: itemsQ.rows,
          samples: samplesQ.rows.map(mapSampleRow),
          checkIn: checkinQ.rows[0] ?? null,
          custody: custodyQ.rows,
          certificate: certQ.rows[0] ?? null,
          payment: payQ.rows[0] ?? null,
        };
      });
      if (!result) return res.status(404).json({ error: 'job_not_found' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/jobs/:id/check-in', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { lat, lon, accuracyM, photo, deviceId, reportedAt } = req.body || {};
    if (lat == null || lon == null || !photo || !deviceId) {
      return res.status(400).json({ error: 'missing_checkin_fields' });
    }
    try {
      // Store the real photo and hash it server-side; the client cannot forge a
      // hash that mismatches the stored image.
      const { sha256 } = await saveCheckinPhoto(req.params.id, photo);
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, distance_m as "distanceM", job_id as "jobId"
             from eworks.check_in($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
          [req.params.id, lat, lon, accuracyM ?? 10, deviceId, sha256, reportedAt ?? null],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'checkin_failed', detail: err.message });
    }
  });

  app.get('/api/vendor/jobs/:id/checkin-photo', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const visible = await withUserSession(userId, async (client) => {
        const q = await client.query(`select 1 from eworks.test_jobs where id = $1`, [req.params.id]);
        return q.rowCount > 0;
      });
      if (!visible) return res.status(404).json({ error: 'not_found' });
      const bytes = await readCheckinPhoto(req.params.id);
      if (!bytes) return res.status(404).json({ error: 'no_photo' });
      res.setHeader('content-type', sniffImageType(bytes));
      res.setHeader('cache-control', 'private, max-age=60');
      res.send(bytes);
    } catch (err) {
      res.status(400).json({ error: 'photo_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/jobs/:id/samples', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { testCode, qrCode, specimenNo, testAgeDays } = req.body || {};
    if (!testCode || !qrCode || !specimenNo) {
      return res.status(400).json({ error: 'missing_sample_fields' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
           select $1, tc.id, $2, $3, $4
             from eworks.test_catalog tc
            where tc.code = $5
           returning id, qr_code as "qrCode", specimen_no as "specimenNo", test_age_days as "testAgeDays"`,
          [req.params.id, qrCode, specimenNo, testAgeDays ?? null, testCode],
        );
        if (q.rowCount === 0) throw new Error('unknown test code');
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'bind_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/custody', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { qrCode, event, lat, lon, deviceId } = req.body || {};
    if (!qrCode || !event) return res.status(400).json({ error: 'qr_and_event_required' });
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select seq, event, occurred_at as "occurredAt"
             from eworks.record_custody($1, $2::eworks.custody_event, $3, $4, $5)`,
          [qrCode, event, lat ?? null, lon ?? null, deviceId ?? null],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'custody_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/results', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { qrCode, measurements } = req.body || {};
    if (!qrCode || !measurements || typeof measurements !== 'object') {
      return res.status(400).json({ error: 'qr_and_measurements_required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, passed, is_provisional as "isProvisional", metric,
                  metric_value as "metricValue", threshold_min as "thresholdMin"
             from eworks.record_test_result($1, $2::jsonb)`,
          [qrCode, JSON.stringify(measurements)],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'result_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/jobs/:id/certificate', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { file } = req.body || {};
    if (!file) return res.status(400).json({ error: 'file_required' });
    try {
      // Store the real PDF and hash it server-side; the recorded sha256 is the
      // hash of the actual document, so the public verify hash is genuine.
      const { sha256, storagePath } = await saveCertificate(req.params.id, file);
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `insert into eworks.certificates (job_id, storage_path, sha256, uploaded_by)
           values ($1, $2, $3, eworks.current_user_id())
           returning id, storage_path as "storagePath", signature_verified as "signatureVerified",
                     issued_at as "issuedAt"`,
          [req.params.id, storagePath, sha256],
        );
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'certificate_failed', detail: err.message });
    }
  });

  app.get('/api/vendor/jobs/:id/certificate/file', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const visible = await withUserSession(userId, async (client) => {
        const q = await client.query(`select 1 from eworks.test_jobs where id = $1`, [req.params.id]);
        return q.rowCount > 0;
      });
      if (!visible) return res.status(404).json({ error: 'not_found' });
      const bytes = await readCertificate(req.params.id);
      if (!bytes) return res.status(404).json({ error: 'no_certificate' });
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', 'inline; filename="certificate.pdf"');
      res.send(bytes);
    } catch (err) {
      res.status(400).json({ error: 'certificate_failed', detail: err.message });
    }
  });

  // --- vendor earnings (RLS-scoped) ------------------------------------------
  app.get('/api/vendor/earnings', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, async (client) => {
        const summaryQ = await client.query(
          `select
             coalesce(sum(amount_paise) filter (where status = 'HELD'), 0)::bigint as "heldPaise",
             coalesce(sum(amount_paise) filter (where status = 'RELEASED'), 0)::bigint as "releasedPaise",
             count(*) filter (where status = 'HELD')::int as "heldCount",
             count(*) filter (where status = 'RELEASED')::int as "releasedCount"
           from eworks.payments`,
        );
        const rowsQ = await client.query(
          `select
             p.id,
             p.order_id        as "orderId",
             o.milestone,
             p.status,
             p.amount_paise    as "amountPaise",
             p.treasury_ref    as "treasuryRef",
             p.gst_invoice_no  as "gstInvoiceNo",
             p.released_at     as "releasedAt",
             p.created_at      as "createdAt"
           from eworks.payments p
           join eworks.test_orders o on o.id = p.order_id
          order by coalesce(p.released_at, p.created_at) desc`,
        );
        return { summary: summaryQ.rows[0], payments: rowsQ.rows };
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  // --- gov: planner & orders (RLS-scoped) ------------------------------------
  app.get('/api/gov/projects', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, code, name
             from eworks.org_units
            where level = 'PROJECT'
              and eworks.has_permission('order.read', path)
            order by name`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/stages', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, code, name, sequence from eworks.construction_stage order by sequence`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  // The distinct quantity units a stage's rules need — the planner renders one
  // input per unit instead of hard-coding a list. ONCE rules need no quantity,
  // so they are excluded. Driven from the catalog, so adding a test with a new
  // unit surfaces automatically.
  app.get('/api/gov/stages/:stageCode/units', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const units = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select distinct tsr.frequency_spec ->> 'unit' as unit
             from eworks.test_stage_rules tsr
             join eworks.construction_stage cs on cs.id = tsr.stage_id
            where cs.code = $1
              and tsr.is_active
              and tsr.org_unit_id is null
              and tsr.frequency_type <> 'ONCE'
              and tsr.frequency_spec ->> 'unit' is not null
            order by 1`,
          [req.params.stageCode],
        );
        return q.rows.map((r) => r.unit);
      });
      res.json({ units });
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/projects/:projectId/requirements', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             ptr.id,
             ptr.planned_count   as "plannedCount",
             ptr.status,
             ptr.required_by     as "requiredBy",
             tc.code             as "testCode",
             tc.name             as "testName",
             cs.code             as "stageCode",
             cs.name             as "stageName"
           from eworks.project_test_requirements ptr
           join eworks.test_catalog tc on tc.id = ptr.test_id
           join eworks.construction_stage cs on cs.id = ptr.stage_id
          where ptr.project_id = $1
          order by cs.sequence, tc.name`,
          [req.params.projectId],
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/catalog/checklist', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const { stageRows, crossRows } = await withUserSession(userId, async (client) => {
        const staged = await client.query(
          `select
             cs.code            as "stageCode",
             cs.name            as "stageName",
             cs.sequence        as "sequence",
             tc.code            as "testCode",
             tc.name            as "testName",
             tc.domain          as "domain",
             coalesce(tsr.is_code, tc.default_is_code) as "isCode",
             tc.requires_nabl   as "requiresNabl",
             tc.typical_tat_days as "tatDays",
             tsr.frequency_type as "frequencyType",
             tsr.frequency_spec as "frequencySpec"
           from eworks.test_stage_rules tsr
           join eworks.test_catalog tc on tc.id = tsr.test_id
           join eworks.construction_stage cs on cs.id = tsr.stage_id
          where tsr.is_active and tc.is_active and tsr.org_unit_id is null
          order by cs.sequence, tc.name`,
        );
        // Cross-stage tests: active catalog tests with no state-wide stage rule
        // (concrete mix design, water quality) — they gate the whole job.
        const cross = await client.query(
          `select
             tc.code            as "testCode",
             tc.name            as "testName",
             tc.domain          as "domain",
             tc.default_is_code as "isCode",
             tc.requires_nabl   as "requiresNabl",
             tc.typical_tat_days as "tatDays"
           from eworks.test_catalog tc
          where tc.is_active
            and not exists (select 1 from eworks.test_stage_rules tsr
                             where tsr.test_id = tc.id and tsr.is_active
                               and tsr.org_unit_id is null)
          order by tc.name`,
        );
        return { stageRows: staged.rows, crossRows: cross.rows };
      });
      res.json(shapeChecklist(stageRows, crossRows));
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/projects/:projectId/checklist', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const data = await withUserSession(userId, async (client) => {
        // All 9 stages, always — a stage with no requirements still renders as
        // "not planned yet". Left joins to the order + cert/result trail give
        // the deep-link ids and the failure signal. RLS on
        // project_test_requirements enforces order.read-in-scope, so an
        // out-of-scope officer simply sees zero requirement rows.
        const q = await client.query(
          `select
             cs.code     as "stageCode",
             cs.name     as "stageName",
             cs.sequence as "sequence",
             ptr.id      as "requirementId",
             tc.code     as "testCode",
             tc.name     as "testName",
             ptr.planned_count as "plannedCount",
             ptr.status  as "ptrStatus",
             o.id        as "orderId",
             o.status    as "orderStatus",
             j.id        as "jobId",
             (cert.id is not null) as "hasCertificate",
             exists (select 1 from eworks.test_results tr
                       where tr.job_id = j.id and tr.passed = false) as "hasFailedResult"
           from eworks.construction_stage cs
           left join eworks.project_test_requirements ptr
             on ptr.stage_id = cs.id and ptr.project_id = $1
           left join eworks.test_catalog tc on tc.id = ptr.test_id
           left join eworks.order_items oi on oi.requirement_id = ptr.id
           left join eworks.test_orders o on o.id = oi.order_id
           left join eworks.test_jobs j on j.order_id = o.id
           left join eworks.certificates cert on cert.job_id = j.id
          order by cs.sequence, tc.name`,
          [req.params.projectId],
        );

        // A requirement can fan out to several rows if it was re-floated (a new
        // order item after a failure). Aggregate the signals across all its rows
        // so a passing retest (CERTIFIED) is not masked by the earlier FAILED
        // order, and keep the most-advanced order/job for the deep link.
        const byStage = new Map();
        const reqAcc = new Map();
        for (const r of q.rows) {
          if (!byStage.has(r.stageCode)) {
            byStage.set(r.stageCode, {
              code: r.stageCode, sequence: r.sequence, name: r.stageName,
              planned: false, rows: [], certifiedCount: 0, totalCount: 0,
            });
          }
          const stage = byStage.get(r.stageCode);
          if (!r.requirementId) continue; // stage with no requirements yet
          stage.planned = true;

          let acc = reqAcc.get(r.requirementId);
          if (!acc) {
            acc = {
              stageCode: r.stageCode, requirementId: r.requirementId,
              testCode: r.testCode, testName: r.testName, plannedCount: r.plannedCount,
              ptrStatus: r.ptrStatus, hasCertificate: false, hasFailedResult: false,
              orderStatus: null, orderId: null, jobId: null,
            };
            reqAcc.set(r.requirementId, acc);
          }
          acc.hasCertificate = acc.hasCertificate || r.hasCertificate;
          acc.hasFailedResult = acc.hasFailedResult || r.hasFailedResult;
          // Prefer the row carrying a certificate for the deep link, else the
          // first order/job we saw.
          if (r.orderId && (r.hasCertificate || !acc.orderId)) {
            acc.orderId = r.orderId;
            acc.orderStatus = r.orderStatus;
            acc.jobId = r.jobId ?? acc.jobId;
          }
        }

        for (const acc of reqAcc.values()) {
          const stage = byStage.get(acc.stageCode);
          const status = deriveReqStatus(acc);
          stage.rows.push({
            requirementId: acc.requirementId,
            testCode: acc.testCode,
            testName: acc.testName,
            plannedCount: acc.plannedCount,
            status,
            orderId: acc.orderId,
            jobId: acc.jobId,
          });
          stage.totalCount += 1;
          if (status === 'CERTIFIED') stage.certifiedCount += 1;
        }
        return { stages: [...byStage.values()] };
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/gov/projects/:projectId/planner/generate', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { stageCode, quantities, requiredBy } = req.body || {};
    if (!stageCode || !quantities) {
      return res.status(400).json({ error: 'stage_and_quantities_required' });
    }
    try {
      const inserted = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select eworks.generate_project_requirements($1, $2, $3::jsonb, $4::date) as inserted`,
          [req.params.projectId, stageCode, JSON.stringify(quantities), requiredBy ?? null],
        );
        return q.rows[0].inserted;
      });
      res.json({ inserted });
    } catch (err) {
      res.status(400).json({ error: 'generate_failed', detail: err.message });
    }
  });

  app.get('/api/gov/orders', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = req.query.projectId || null;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             o.id,
             o.project_id        as "projectId",
             o.milestone,
             o.status,
             o.required_by       as "requiredBy",
             o.floated_at        as "floatedAt",
             o.bid_close_at      as "bidCloseAt",
             o.reveal_close_at   as "revealCloseAt",
             cs.code             as "stageCode",
             ou.name             as "orgName",
             (select count(*)::int from eworks.order_items oi where oi.order_id = o.id) as "itemCount"
           from eworks.test_orders o
           join eworks.construction_stage cs on cs.id = o.stage_id
           join eworks.org_units ou on ou.id = o.org_unit_id
          where ($1::uuid is null or o.project_id = $1::uuid)
          order by o.created_at desc`,
          [projectId],
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/gov/orders', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { projectId, stageCode, milestone, requirementIds } = req.body || {};
    if (!projectId || !stageCode || !milestone || !requirementIds?.length) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const metaQ = await client.query(
          `select cs.id as stage_id,
                  (select s.id from eworks.org_units proj
                     join eworks.org_units s on s.level = 'SECTION' and proj.path <@ s.path
                    where proj.id = $1
                    order by nlevel(s.path) desc limit 1) as org_unit_id
             from eworks.construction_stage cs
            where cs.code = $2`,
          [projectId, stageCode],
        );
        const meta = metaQ.rows[0];
        if (!meta?.org_unit_id) throw new Error('could not resolve section for project');

        const reqQ = await client.query(
          `select ptr.id, ptr.test_id, ptr.planned_count, tc.code
             from eworks.project_test_requirements ptr
             join eworks.test_catalog tc on tc.id = ptr.test_id
            where ptr.id = any($1::uuid[])
              and ptr.project_id = $2
              and ptr.status = 'PLANNED'`,
          [requirementIds, projectId],
        );
        if (reqQ.rowCount === 0) throw new Error('no planned requirements selected');

        const requiredBy = await client.query(
          `select min(required_by) as d from eworks.project_test_requirements where id = any($1::uuid[])`,
          [requirementIds],
        );

        const orderQ = await client.query(
          `insert into eworks.test_orders
             (project_id, org_unit_id, milestone, stage_id, site, required_by, created_by)
           values ($1, $2, $3, $4, st_makepoint(76.9558, 11.0168)::geography, coalesce($5::date, current_date + 30), eworks.current_user_id())
           returning id, status, milestone`,
          [projectId, meta.org_unit_id, milestone.trim(), meta.stage_id, requiredBy.rows[0]?.d],
        );
        const order = orderQ.rows[0];

        for (const item of reqQ.rows) {
          const ages = item.code === 'CONCRETE_CUBE_STRENGTH' ? '{7,28}' : '{}';
          await client.query(
            `insert into eworks.order_items (order_id, test_id, requirement_id, quantity, test_ages_days)
             values ($1, $2, $3, $4, $5::int[])`,
            [order.id, item.test_id, item.id, item.planned_count, ages],
          );
        }

        return { ...order, itemCount: reqQ.rowCount };
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'create_failed', detail: err.message });
    }
  });

  app.post('/api/gov/orders/:id/float', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             id,
             status,
             floated_at        as "floatedAt",
             bid_close_at      as "bidCloseAt",
             reveal_close_at   as "revealCloseAt"
           from eworks.float_order($1)`,
          [req.params.id],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'float_failed', detail: err.message });
    }
  });

  app.get('/api/gov/orders/:id', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await withUserSession(userId, async (client) => {
        const orderQ = await client.query(
          `select
             o.id,
             o.project_id        as "projectId",
             o.milestone,
             o.status,
             o.eval_method       as "evalMethod",
             o.required_by       as "requiredBy",
             o.floated_at        as "floatedAt",
             o.bid_close_at      as "bidCloseAt",
             o.reveal_close_at   as "revealCloseAt",
             cs.code             as "stageCode",
             ou.name             as "orgName",
             (select count(*)::int from eworks.order_items oi where oi.order_id = o.id) as "itemCount",
             exists (
               select 1 from eworks.org_units ou2
                where ou2.id = o.org_unit_id
                  and eworks.has_permission('order.award', ou2.path)
             ) as "canAward"
           from eworks.test_orders o
           join eworks.construction_stage cs on cs.id = o.stage_id
           join eworks.org_units ou on ou.id = o.org_unit_id
          where o.id = $1`,
          [req.params.id],
        );
        if (orderQ.rowCount === 0) return null;

        const itemsQ = await client.query(
          `select
             oi.id, oi.quantity, oi.test_ages_days as "testAgesDays",
             tc.code as "testCode", tc.name as "testName",
             tc.requires_nabl as "requiresNabl", tc.default_is_code as "isCode"
           from eworks.order_items oi
           join eworks.test_catalog tc on tc.id = oi.test_id
          where oi.order_id = $1 order by tc.name`,
          [req.params.id],
        );

        const bidsQ = await client.query(
          `select
             b.id,
             b.status,
             b.committed_at          as "committedAt",
             b.revealed_price_paise  as "revealedPricePaise",
             b.revealed_at           as "revealedAt",
             v.legal_name            as "vendorName"
           from eworks.order_bids b
           join eworks.vendors v on v.id = b.vendor_id
          where b.order_id = $1
          order by b.revealed_price_paise asc nulls last, b.committed_at asc`,
          [req.params.id],
        );

        const awardQ = await client.query(
          `select
             a.vendor_id           as "vendorId",
             v.legal_name          as "vendorName",
             a.price_paise         as "pricePaise",
             a.qualified_bid_count as "qualifiedBidCount",
             a.awarded_at          as "awardedAt"
           from eworks.order_award a
           join eworks.vendors v on v.id = a.vendor_id
          where a.order_id = $1`,
          [req.params.id],
        );

        return {
          ...orderQ.rows[0],
          items: itemsQ.rows,
          bids: bidsQ.rows,
          award: awardQ.rows[0] ?? null,
          fulfillment:
            orderQ.rows[0].status === 'AWARDED'
              ? await fetchFulfillment(client, req.params.id)
              : null,
        };
      });
      if (!result) return res.status(404).json({ error: 'order_not_found' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/gov/orders/:id/close-bidding', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, status, bid_close_at as "bidCloseAt", reveal_close_at as "revealCloseAt"
             from eworks.close_bidding($1)`,
          [req.params.id],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'close_failed', detail: err.message });
    }
  });

  app.post('/api/gov/orders/:id/award', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        // LEFT JOIN, not JOIN: the winning lab can be outside the awarding
        // officer's org scope (eligibility is by service radius, not org), so an
        // RLS-scoped read of the vendor may be empty. Award success is decided by
        // whether finalize_award returned an award row, never by RLS visibility.
        const q = await client.query(
          `select
             a.order_id            as "orderId",
             a.vendor_id           as "vendorId",
             v.legal_name          as "vendorName",
             a.price_paise         as "pricePaise",
             a.qualified_bid_count as "qualifiedBidCount",
             a.awarded_at          as "awardedAt",
             (select status from eworks.test_orders where id = $1) as "orderStatus"
           from eworks.finalize_award($1) a
           left join eworks.vendors v on v.id = a.vendor_id`,
          [req.params.id],
        );
        // finalize_award returns a NULL row when no qualified bid remained (order
        // FAILED). A real award always has an order_id.
        if (q.rowCount === 0 || !q.rows[0].orderId) {
          const statusQ = await client.query(
            `select status from eworks.test_orders where id = $1`,
            [req.params.id],
          );
          return { failed: true, orderStatus: statusQ.rows[0]?.status ?? 'FAILED' };
        }
        await client.query(`select eworks.hold_payment($1)`, [req.params.id]);
        return { failed: false, ...q.rows[0] };
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'award_failed', detail: err.message });
    }
  });

  app.post('/api/gov/orders/:id/certificate/verify', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { signerName } = req.body || {};
    try {
      const allowed = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select exists (
             select 1 from eworks.test_orders o
               join eworks.org_units ou on ou.id = o.org_unit_id
              where o.id = $1
                and eworks.has_permission('result.verify', ou.path)
           ) as ok`,
          [req.params.id],
        );
        return q.rows[0].ok;
      });
      if (!allowed) return res.status(403).json({ error: 'permission_denied' });

      const client = await pool.connect();
      try {
        const jobQ = await client.query(
          `select id from eworks.test_jobs where order_id = $1`,
          [req.params.id],
        );
        if (jobQ.rowCount === 0) throw new Error('no job for order');
        const q = await client.query(
          `update eworks.certificates
              set signature_verified = true,
                  signer_name = coalesce($2, 'Dev DSC verifier'),
                  verified_at = now()
            where job_id = $1 and signature_verified = false
            returning id, signature_verified as "signatureVerified",
                      signer_name as "signerName", verified_at as "verifiedAt"`,
          [jobQ.rows[0].id, signerName ?? null],
        );
        if (q.rowCount === 0) throw new Error('certificate not found or already verified');
        res.json(q.rows[0]);
      } finally {
        client.release();
      }
    } catch (err) {
      res.status(400).json({ error: 'verify_failed', detail: err.message });
    }
  });

  app.get('/api/gov/orders/:id/checkin-photo', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const resolved = await withUserSession(userId, async (client) => {
        // Viewing site evidence is a read, so gate on order.read (not verify).
        const allowed = await client.query(
          `select exists (
             select 1 from eworks.test_orders o
               join eworks.org_units ou on ou.id = o.org_unit_id
              where o.id = $1
                and eworks.has_permission('order.read', ou.path)
           ) as ok`,
          [req.params.id],
        );
        if (!allowed.rows[0].ok) return { denied: true };
        const j = await client.query(
          `select id from eworks.test_jobs where order_id = $1 limit 1`,
          [req.params.id],
        );
        return { jobId: j.rows[0]?.id ?? null };
      });
      if (resolved.denied) return res.status(403).json({ error: 'permission_denied' });
      if (!resolved.jobId) return res.status(404).json({ error: 'no_job' });
      const bytes = await readCheckinPhoto(resolved.jobId);
      if (!bytes) return res.status(404).json({ error: 'no_photo' });
      res.setHeader('content-type', sniffImageType(bytes));
      res.setHeader('cache-control', 'private, max-age=60');
      res.send(bytes);
    } catch (err) {
      res.status(400).json({ error: 'photo_failed', detail: err.message });
    }
  });

  app.get('/api/gov/orders/:id/certificate/file', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const resolved = await withUserSession(userId, async (client) => {
        const allowed = await client.query(
          `select exists (
             select 1 from eworks.test_orders o
               join eworks.org_units ou on ou.id = o.org_unit_id
              where o.id = $1 and eworks.has_permission('order.read', ou.path)
           ) as ok`,
          [req.params.id],
        );
        if (!allowed.rows[0].ok) return { denied: true };
        const j = await client.query(
          `select id from eworks.test_jobs where order_id = $1 limit 1`,
          [req.params.id],
        );
        return { jobId: j.rows[0]?.id ?? null };
      });
      if (resolved.denied) return res.status(403).json({ error: 'permission_denied' });
      if (!resolved.jobId) return res.status(404).json({ error: 'no_job' });
      const bytes = await readCertificate(resolved.jobId);
      if (!bytes) return res.status(404).json({ error: 'no_certificate' });
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', 'inline; filename="certificate.pdf"');
      res.send(bytes);
    } catch (err) {
      res.status(400).json({ error: 'certificate_failed', detail: err.message });
    }
  });

  app.post('/api/gov/orders/:id/payment/release', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { idempotencyKey, treasuryRef, gstInvoiceNo } = req.body || {};
    if (!idempotencyKey) return res.status(400).json({ error: 'idempotency_key_required' });
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select id, status, amount_paise as "amountPaise", treasury_ref as "treasuryRef",
                  gst_invoice_no as "gstInvoiceNo", released_at as "releasedAt"
             from eworks.release_payment($1, $2, $3, $4)`,
          [req.params.id, idempotencyKey, treasuryRef ?? null, gstInvoiceNo ?? null],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'release_failed', detail: err.message });
    }
  });

  if (!config.isProd) {
    // Dev-only: advance auction clocks so local demos don't wait 48h.
    app.post('/api/dev/orders/:id/advance', async (req, res) => {
      const userId = requireUser(req, res);
      if (!userId) return;
      const { stage } = req.body || {};
      if (stage !== 'reveal' && stage !== 'award') {
        return res.status(400).json({ error: 'stage must be reveal or award' });
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        if (stage === 'reveal') {
          // Pull floated_at back too, so bid_close_at stays after it (the
          // orders_close_after_float check) even for a just-floated demo order.
          await client.query(
            `update eworks.test_orders
                set floated_at = least(floated_at, now() - interval '2 days'),
                    bid_close_at = now() - interval '1 minute'
              where id = $1 and status = 'FLOATED'`,
            [req.params.id],
          );
          await client.query(`select eworks.close_bidding($1)`, [req.params.id]);
        } else {
          await client.query(
            `update eworks.test_orders
                set reveal_close_at = now() - interval '1 second'
              where id = $1 and status = 'REVEALING'`,
            [req.params.id],
          );
        }
        const q = await client.query(
          `select id, status, bid_close_at as "bidCloseAt", reveal_close_at as "revealCloseAt"
             from eworks.test_orders where id = $1`,
          [req.params.id],
        );
        await client.query('commit');
        res.json(q.rows[0]);
      } catch (err) {
        await client.query('rollback').catch(() => {});
        res.status(400).json({ error: 'advance_failed', detail: err.message });
      } finally {
        client.release();
      }
    });

    // Dev-only: advance a field job to "received at lab" for result-entry demos.
    app.post('/api/dev/jobs/:id/advance', async (req, res) => {
      const userId = requireUser(req, res);
      if (!userId) return;
      const TECH = '44444444-0000-0000-0000-00000000000f';
      const jobId = req.params.id;
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.user_id', $1, true)`, [TECH]);

        const jobQ = await client.query(
          `select j.id, j.status, j.device_id as "deviceId", j.technician_id as "techId"
             from eworks.test_jobs j where j.id = $1`,
          [jobId],
        );
        if (jobQ.rowCount === 0) throw new Error('job not found');

        let deviceId = jobQ.rows[0].deviceId ?? 'dev-device-1';
        if (jobQ.rows[0].status === 'ASSIGNED') {
          const photo = await client.query(
            `select digest(convert_to($1::text, 'UTF8'), 'sha256') as h`,
            [jobId],
          );
          await client.query(
            `select eworks.check_in($1, 11.01760, 76.9558, 10, $2, $3, now())`,
            [jobId, deviceId, photo.rows[0].h],
          );
        }

        let qrRow = await client.query(
          `select qr_code as "qrCode" from eworks.samples where job_id = $1 limit 1`,
          [jobId],
        );
        let qrCode = qrRow.rows[0]?.qrCode;
        if (!qrCode) {
          const body = jobId.replace(/-/g, '').slice(0, 12).replace(/[01IO]/g, '2').toUpperCase();
          qrCode = `EW-${body}`;
          await client.query(
            `insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
             select $1, id, $2, 1, 28 from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH'`,
            [jobId, qrCode],
          );
        }

        for (const event of ['MOLDED', 'SEALED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED_AT_LAB']) {
          const exists = await client.query(
            `select 1 from eworks.chain_of_custody c
               join eworks.samples s on s.id = c.sample_id
              where s.job_id = $1 and s.qr_code = $2 and c.event = $3::eworks.custody_event`,
            [jobId, qrCode, event],
          );
          if (exists.rowCount === 0) {
            await client.query(
              `select eworks.record_custody($1, $2::eworks.custody_event, 11.0176, 76.9558, $3)`,
              [qrCode, event, deviceId],
            );
          }
        }

        const out = await client.query(
          `select id, status from eworks.test_jobs where id = $1`,
          [jobId],
        );
        await client.query('commit');
        res.json({ ...out.rows[0], qrCode });
      } catch (err) {
        await client.query('rollback').catch(() => {});
        res.status(400).json({ error: 'advance_failed', detail: err.message });
      } finally {
        client.release();
      }
    });
  }

  app.get('/api/gov/quality', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const projectId = req.query.projectId || null;
    try {
      const payload = await withUserSession(userId, async (client) => {
        const params = projectId ? [projectId] : [];
        const projectFilter = projectId ? 'and o.project_id = $1' : '';
        const q = await client.query(
          `select
             o.id,
             o.milestone,
             o.status,
             o.required_by       as "requiredBy",
             cs.code             as "stageCode",
             ou.name             as "orgName",
             v.legal_name        as "vendorName",
             (select count(*)::int from eworks.escalations e
               where e.order_id = o.id and e.status = 'OPEN') as "openEscalations",
             pay.status          as "paymentStatus",
             coalesce(cert.signature_verified, false) as "certVerified",
             (select count(*)::int from eworks.test_jobs j where j.order_id = o.id) as "hasJob",
             (select count(*)::int from eworks.samples s
                join eworks.test_jobs j on j.id = s.job_id
               where j.order_id = o.id) as "sampleCount",
             (select count(*)::int from eworks.test_results r
                join eworks.test_jobs j on j.id = r.job_id
               where j.order_id = o.id) as "resultCount",
             (select bool_and(r.passed) from eworks.test_results r
                join eworks.test_jobs j on j.id = r.job_id
               where j.order_id = o.id) as "allPassed"
           from eworks.test_orders o
           join eworks.construction_stage cs on cs.id = o.stage_id
           join eworks.org_units ou on ou.id = o.org_unit_id
           left join eworks.order_award oa on oa.order_id = o.id
           left join eworks.vendors v on v.id = oa.vendor_id
           left join eworks.test_jobs j on j.order_id = o.id
           left join eworks.payments pay on pay.order_id = o.id
           left join eworks.certificates cert on cert.job_id = j.id
          where o.status <> 'CANCELLED'
            ${projectFilter}
          order by o.required_by asc, o.milestone asc`,
          params,
        );

        const milestones = q.rows.map((row) => ({
          ...row,
          health: computeMilestoneHealth(row),
        }));
        const counts = { green: 0, amber: 0, red: 0, neutral: 0 };
        for (const m of milestones) counts[m.health] += 1;
        return { counts, milestones };
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/dashboard/map', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, async (client) => {
        // Anchor = caller's most senior gov org unit.
        const anchorQ = await client.query(
          `select ou.id, ou.name, ou.path::text as path, ou.level,
                  eworks.org_level_ordinal(ou.level) as ord
             from eworks.user_roles ur
             join eworks.org_units ou on ou.id = ur.org_unit_id
            where ur.user_id = eworks.current_user_id()
              and ur.role_code in ('SITE_ENGINEER','EXECUTIVE_ENGINEER','DISTRICT_OFFICER',
                                   'SUPERINTENDING_ENGINEER','AUDITOR','HEAD_ADMIN')
            order by ord asc limit 1`);
        const anchor = anchorQ.rows[0];
        if (!anchor) return { level: 'state', key: 'tamilnadu', regions: [] };
        const level = anchor.level === 'STATE' ? 'state' : 'district';
        const key = level === 'state'
          ? 'tamilnadu'
          : anchor.path.split('.')[1].toLowerCase();

        const regions = await loadChildRegions(client, anchor.path);
        return { level, key, regions };
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/analytics', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, async (client) => {
        const statusQ = await client.query(
          `select status, count(*)::int as count
             from eworks.test_orders
            where status <> 'CANCELLED'
            group by status
            order by count desc`,
        );
        const totalsQ = await client.query(
          `select
             count(*) filter (where status in ('FLOATED','REVEALING'))::int as floated,
             count(*) filter (where status = 'AWARDED')::int as awarded,
             (select count(*)::int from eworks.order_bids) as "bidsSubmitted",
             (select count(*)::int from eworks.order_bids where revealed_price_paise is not null) as "bidsRevealed",
             coalesce((select sum(amount_paise) from eworks.payments where status = 'HELD'), 0)::bigint as "paymentsHeldPaise",
             coalesce((select sum(amount_paise) from eworks.payments where status = 'RELEASED'), 0)::bigint as "paymentsReleasedPaise",
             (select count(*)::int from eworks.escalations where status = 'OPEN') as "openEscalations",
             (select count(*)::int from eworks.certificates where signature_verified) as "certificatesVerified"
             from eworks.test_orders`,
        );
        const awardsQ = await client.query(
          `select
             o.id as "orderId",
             o.milestone,
             v.legal_name as "vendorName",
             oa.price_paise as "pricePaise",
             oa.awarded_at as "awardedAt"
           from eworks.order_award oa
           join eworks.test_orders o on o.id = oa.order_id
           join eworks.vendors v on v.id = oa.vendor_id
          order by oa.awarded_at desc
          limit 8`,
        );
        const t = totalsQ.rows[0];
        return {
          ordersByStatus: statusQ.rows,
          totals: {
            floated: Number(t.floated),
            awarded: Number(t.awarded),
            bidsSubmitted: Number(t.bidsSubmitted),
            bidsRevealed: Number(t.bidsRevealed),
            paymentsHeldPaise: Number(t.paymentsHeldPaise),
            paymentsReleasedPaise: Number(t.paymentsReleasedPaise),
            openEscalations: Number(t.openEscalations),
            certificatesVerified: Number(t.certificatesVerified),
          },
          recentAwards: awardsQ.rows.map((r) => ({
            ...r,
            pricePaise: Number(r.pricePaise),
          })),
        };
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/ratings', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             v.id,
             v.legal_name as "legalName",
             v.status,
             ou.name      as "districtName",
             count(distinct oa.order_id)::int as "awardsWon",
             count(distinct j.id) filter (where pay.status = 'RELEASED')::int as "jobsCompleted",
             count(distinct e.id) filter (where e.status = 'OPEN')::int as "openEscalations",
             count(r.id)::int as "resultCount",
             coalesce(avg(case when r.passed then 1.0 else 0.0 end), 0) as "passRate"
           from eworks.vendors v
           join eworks.org_units ou on ou.id = v.org_unit_id
           left join eworks.order_award oa on oa.vendor_id = v.id
           left join eworks.test_jobs j on j.vendor_id = v.id
           left join eworks.test_orders o on o.id = j.order_id
           left join eworks.payments pay on pay.order_id = o.id
           left join eworks.test_results r on r.job_id = j.id
           left join eworks.escalations e on e.order_id = o.id
          where v.status in ('APPROVED', 'SUBMITTED')
          group by v.id, v.legal_name, v.status, ou.name
          having count(distinct oa.order_id) > 0 or count(distinct j.id) > 0
          order by "jobsCompleted" desc, "passRate" desc, v.legal_name asc`,
        );
        return q.rows.map((row) => ({
          ...row,
          passRate: Number(row.passRate),
          tier: computeVendorTier(row),
        }));
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/audit/chain', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        const permQ = await client.query(
          `select (
             eworks.has_permission_anywhere('audit.read')
             or eworks.has_permission_anywhere('audit.read_all')
           ) as allowed`,
        );
        if (!permQ.rows[0].allowed) return { allowed: false };
        const brokenQ = await client.query(`select eworks.verify_audit_chain() as broken`);
        const headQ = await client.query(
          `select seq, encode(row_hash, 'hex') as hash from eworks.audit_head()`,
        );
        const broken = brokenQ.rows[0].broken;
        return {
          allowed: true,
          intact: broken === null,
          brokenAtSeq: broken != null ? Number(broken) : null,
          headSeq: headQ.rows[0]?.seq ?? null,
          headHash: headQ.rows[0]?.hash ?? null,
        };
      });
      if (!row.allowed) return res.json(row);
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/audit', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = req.query.before ? Number(req.query.before) : null;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             a.seq,
             a.action,
             a.entity_type  as "entityType",
             a.entity_id    as "entityId",
             a.org_path::text as "orgPath",
             a.payload,
             a.occurred_at  as "occurredAt",
             p.full_name    as "actorName"
           from eworks.audit_logs a
           left join eworks.user_profiles p on p.id = a.actor_id
          where ($2::bigint is null or a.seq < $2)
          order by a.seq desc
          limit $1`,
          [limit, before],
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  // Officers directory — RLS-scoped via user.read / user_roles policies.
  // Returns one row per role grant (a person with two roles appears twice).
  app.get('/api/gov/officers', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             p.id              as "userId",
             p.phone,
             p.full_name       as "fullName",
             p.is_active       as "isActive",
             ur.role_code      as "roleCode",
             initcap(replace(ur.role_code, '_', ' ')) as "roleName",
             ou.id             as "orgUnitId",
             ou.name           as "orgName",
             ou.level          as "orgLevel",
             ou.path::text     as "orgPath",
             ur.granted_at     as "grantedAt",
             ur.expires_at     as "expiresAt"
           from eworks.user_roles ur
           join eworks.user_profiles p on p.id = ur.user_id
           join eworks.org_units ou on ou.id = ur.org_unit_id
          where ur.role_code in (
            'HEAD_ADMIN',
            'DISTRICT_OFFICER',
            'SUPERINTENDING_ENGINEER',
            'EXECUTIVE_ENGINEER',
            'SITE_ENGINEER',
            'AUDITOR'
          )
            and (ur.expires_at is null or ur.expires_at > now())
            and ou.is_active
          order by
            case ou.level
              when 'STATE' then 0
              when 'DISTRICT' then 1
              when 'DIVISION' then 2
              when 'CIRCLE' then 3
              when 'SUBDIVISION' then 4
              when 'SECTION' then 5
              when 'FIELD_UNIT' then 6
              else 7
            end,
            ou.name,
            ur.role_code,
            p.full_name`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/vendors', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const status = String(req.query.status || 'SUBMITTED');
    const filterAll = status.toUpperCase() === 'ALL';
    const baseSelect = `
      select
        v.id,
        v.legal_name        as "legalName",
        v.status,
        v.gstin,
        v.pan,
        v.nabl_no           as "nablNo",
        v.nabl_valid_until  as "nablValidUntil",
        ou.name             as "districtName",
        v.created_at        as "createdAt",
        (select count(*)::int
           from eworks.vendor_documents d
          where d.vendor_id = v.id and d.status = 'APPROVED') as "approvedDocCount",
        (select count(*)::int
           from eworks.vendor_documents d
          where d.vendor_id = v.id) as "uploadedDocCount"
      from eworks.vendors v
      join eworks.org_units ou on ou.id = v.org_unit_id`;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = filterAll
          ? await client.query(`${baseSelect} order by v.created_at desc`)
          : await client.query(
              `${baseSelect} where v.status = $1::eworks.vendor_status order by v.created_at desc`,
              [status],
            );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/vendors/:id', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const result = await withUserSession(userId, async (client) => {
        const vQ = await client.query(
          `select
             v.id,
             v.legal_name        as "legalName",
             v.status,
             v.gstin,
             v.pan,
             v.nabl_no           as "nablNo",
             v.nabl_valid_until  as "nablValidUntil",
             v.address,
             v.service_radius_km as "serviceRadiusKm",
             ou.name             as "districtName",
             v.created_at        as "createdAt",
             up.full_name        as "contactName",
             up.phone            as "contactPhone"
           from eworks.vendors v
           join eworks.org_units ou on ou.id = v.org_unit_id
           join eworks.user_profiles up on up.id = v.owner_user_id
          where v.id = $1`,
          [req.params.id],
        );
        if (vQ.rowCount === 0) return null;

        const docsQ = await client.query(
          `select id, doc_type as "docType", status, mime_type as "mimeType",
                  storage_path as "storagePath", reject_reason as "rejectReason",
                  uploaded_at as "uploadedAt"
             from eworks.vendor_documents
            where vendor_id = $1
            order by doc_type`,
          [req.params.id],
        );

        const capQ = await client.query(
          `select tc.code as "testCode", tc.name as "testName", c.is_nabl_accredited as "isNablAccredited"
             from eworks.vendor_test_capabilities c
             join eworks.test_catalog tc on tc.id = c.test_id
            where c.vendor_id = $1 and c.is_active`,
          [req.params.id],
        );

        return { ...vQ.rows[0], documents: docsQ.rows, capabilities: capQ.rows };
      });
      if (!result) return res.status(404).json({ error: 'vendor_not_found' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/gov/vendors/register', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const {
      legalName,
      contactName,
      phone,
      email,
      gstin,
      pan,
      address,
      categories,
    } = req.body || {};
    const cleanPhone = String(phone ?? '').replace(/\D/g, '').slice(-10);
    if (!legalName?.trim() || !contactName?.trim() || cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }
    if (!gstin?.trim() || !pan?.trim() || !address?.trim()) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const permQ = await client.query(
          `select eworks.has_permission('vendor.approve') as ok`,
        );
        if (!permQ.rows[0]?.ok) throw new Error('forbidden');

        const districtQ = await client.query(
          `select ou.id, ou.name, ou.path
             from eworks.user_roles ur
             join eworks.org_units ou on ou.id = ur.org_unit_id
            where ur.user_id = eworks.current_user_id()
              and ur.role_code in ('DISTRICT_OFFICER', 'EXECUTIVE_ENGINEER', 'SUPERINTENDING_ENGINEER', 'HEAD_ADMIN')
            order by nlevel(ou.path)
            limit 1`,
        );
        const district = districtQ.rows[0];
        if (!district) throw new Error('no district scope for officer');

        const existingUserQ = await client.query(
          `select id from eworks.user_profiles where phone = $1`,
          [cleanPhone],
        );
        if (existingUserQ.rowCount > 0) {
          throw new Error('phone already registered — vendor must sign in with OTP');
        }

        const ownerId = crypto.randomUUID();
        await client.query(
          `insert into eworks.user_profiles (id, phone, full_name) values ($1, $2, $3)`,
          [ownerId, cleanPhone, contactName.trim()],
        );
        await client.query(
          `insert into eworks.user_roles (user_id, role_code, org_unit_id)
           values ($1, 'LAB_VENDOR', $2)
           on conflict on constraint user_roles_unique do nothing`,
          [ownerId, district.id],
        );

        const note = email?.trim()
          ? `${address.trim()} · ${email.trim()}${categories?.length ? ` · ${categories.join(', ')}` : ''}`
          : address.trim();

        const vQ = await client.query(
          `insert into eworks.vendors
             (owner_user_id, org_unit_id, legal_name, gstin, pan, address,
              location, service_radius_km, status)
           values ($1, $2, $3, $4, $5, $6,
                   st_makepoint(76.9558, 11.0168)::geography, 50, 'DRAFT')
           returning id, legal_name as "legalName", status, gstin,
                     created_at as "createdAt"`,
          [
            ownerId,
            district.id,
            legalName.trim(),
            gstin.trim().toUpperCase(),
            pan.trim().toUpperCase(),
            note,
          ],
        );
        return { ...vQ.rows[0], districtName: district.name, pan: pan.trim().toUpperCase() };
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'register_failed', detail: err.message });
    }
  });

  app.post('/api/gov/vendors/:id/review', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { decision } = req.body || {};
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'decision must be approve or reject' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          decision === 'approve'
            ? `update eworks.vendors
                  set status = 'APPROVED',
                      approved_by = eworks.current_user_id(),
                      approved_at = now(),
                      updated_at = now()
                where id = $1 and status = 'SUBMITTED'
                returning id, legal_name as "legalName", status`
            : `update eworks.vendors
                  set status = 'REJECTED',
                      approved_by = null,
                      approved_at = null,
                      updated_at = now()
                where id = $1 and status = 'SUBMITTED'
                returning id, legal_name as "legalName", status`,
          [req.params.id],
        );
        if (q.rowCount === 0) throw new Error('vendor not found or not in SUBMITTED status');
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'review_failed', detail: err.message });
    }
  });

  // --- vendor KYC onboarding ---------------------------------------------------
  async function fetchVendorOnboarding(client) {
    const vQ = await client.query(
      `select
         v.id,
         v.legal_name as "legalName",
         v.gstin,
         v.pan,
         v.address,
         v.service_radius_km as "serviceRadiusKm",
         v.nabl_no as "nablNo",
         v.nabl_valid_until as "nablValidUntil",
         v.is_govt_approved as "isGovtApproved",
         v.status,
         v.org_unit_id as "orgUnitId",
         ou.name as "districtName",
         st_y(v.location::geometry) as lat,
         st_x(v.location::geometry) as lng
       from eworks.vendors v
       join eworks.org_units ou on ou.id = v.org_unit_id
      where v.owner_user_id = eworks.current_user_id()
      limit 1`,
    );
    const vendor = vQ.rows[0] ?? null;

    const testsQ = await client.query(
      `select id, code, name, requires_nabl as "requiresNabl"
         from eworks.test_catalog
        where is_active
        order by domain, code`,
    );
    if (!vendor) {
      return { vendor: null, documents: [], capabilities: [], tests: testsQ.rows };
    }

    const docsQ = await client.query(
      `select id, doc_type as "docType", status, mime_type as "mimeType",
              storage_path as "storagePath", reject_reason as "rejectReason"
         from eworks.vendor_documents
        where vendor_id = $1
        order by doc_type`,
      [vendor.id],
    );
    const capQ = await client.query(
      `select c.test_id as "testId", tc.code as "testCode", tc.name as "testName",
              c.is_nabl_accredited as "isNablAccredited",
              c.accredited_from as "accreditedFrom",
              c.accredited_to as "accreditedTo"
         from eworks.vendor_test_capabilities c
         join eworks.test_catalog tc on tc.id = c.test_id
        where c.vendor_id = $1 and c.is_active`,
      [vendor.id],
    );
    return {
      vendor,
      documents: docsQ.rows,
      capabilities: capQ.rows,
      tests: testsQ.rows,
    };
  }

  app.get('/api/vendor/onboarding', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, (client) => fetchVendorOnboarding(client));
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/onboarding/profile', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const {
      legalName,
      gstin,
      pan,
      address,
      lat,
      lng,
      serviceRadiusKm,
      nablNo,
      nablValidUntil,
      isGovtApproved,
      orgUnitId,
    } = req.body || {};
    if (!legalName || !gstin || !pan || !address || lat == null || lng == null) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const districtQ = await client.query(
          `select ur.org_unit_id as id, ou.name
             from eworks.user_roles ur
             join eworks.org_units ou on ou.id = ur.org_unit_id
            where ur.user_id = eworks.current_user_id()
              and ur.role_code = 'LAB_VENDOR'
            limit 1`,
        );
        const districtId = orgUnitId ?? districtQ.rows[0]?.id;
        if (!districtId) throw new Error('no LAB_VENDOR district on account');

        const existingQ = await client.query(
          `select id, status from eworks.vendors where owner_user_id = eworks.current_user_id()`,
        );
        const existing = existingQ.rows[0];
        if (existing && !['DRAFT', 'REJECTED'].includes(existing.status)) {
          throw new Error('vendor profile is locked after submission');
        }

        const params = [
          legalName.trim(),
          gstin.trim().toUpperCase(),
          pan.trim().toUpperCase(),
          address.trim(),
          Number(lat),
          Number(lng),
          Number(serviceRadiusKm) || 50,
          nablNo?.trim() || null,
          nablValidUntil || null,
          Boolean(isGovtApproved),
          districtId,
        ];

        if (existing) {
          const u = await client.query(
            `update eworks.vendors
                set legal_name = $1, gstin = $2, pan = $3, address = $4,
                    location = st_makepoint($6, $5)::geography,
                    service_radius_km = $7,
                    nabl_no = $8,
                    nabl_valid_until = $9,
                    is_govt_approved = $10,
                    org_unit_id = $11,
                    updated_at = now()
              where id = $12 and owner_user_id = eworks.current_user_id()
                and status in ('DRAFT', 'REJECTED')
            returning id, status`,
            [...params, existing.id],
          );
          if (u.rowCount === 0) throw new Error('update failed — check vendor status');
          return u.rows[0];
        }

        const i = await client.query(
          `insert into eworks.vendors
             (owner_user_id, org_unit_id, legal_name, gstin, pan, address,
              location, service_radius_km, nabl_no, nabl_valid_until, is_govt_approved, status)
           values (eworks.current_user_id(), $11, $1, $2, $3, $4,
                   st_makepoint($6, $5)::geography, $7, $8, $9, $10, 'DRAFT')
           returning id, status`,
          params,
        );
        return i.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'profile_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/onboarding/documents', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { docType, dataUrl, mimeType } = req.body || {};
    if (!docType || !dataUrl) return res.status(400).json({ error: 'docType and dataUrl required' });
    if (!KYC_DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'invalid_doc_type' });
    try {
      const row = await withUserSession(userId, async (client) => {
        const vQ = await client.query(
          `select id from eworks.vendors
            where owner_user_id = eworks.current_user_id()
              and status in ('DRAFT', 'REJECTED')`,
        );
        if (vQ.rowCount === 0) throw new Error('save profile first');
        const vendorId = vQ.rows[0].id;

        const saved = await saveKycDocument(vendorId, docType, dataUrl, mimeType);
        await client.query(`delete from eworks.vendor_documents where vendor_id = $1 and doc_type = $2::eworks.vendor_doc_type`, [
          vendorId,
          docType,
        ]);
        const q = await client.query(
          `insert into eworks.vendor_documents
             (vendor_id, doc_type, storage_path, mime_type, sha256, scanned_clean, status)
           values ($1, $2::eworks.vendor_doc_type, $3, $4, $5, true, 'PENDING')
           returning id, doc_type as "docType", status, mime_type as "mimeType", storage_path as "storagePath"`,
          [vendorId, docType, saved.storagePath, saved.mimeType, saved.sha256],
        );
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'upload_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/onboarding/capabilities', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { testIds } = req.body || {};
    if (!Array.isArray(testIds) || testIds.length === 0) {
      return res.status(400).json({ error: 'testIds required' });
    }
    try {
      const count = await withUserSession(userId, async (client) => {
        const vQ = await client.query(
          `select id, nabl_valid_until from eworks.vendors
            where owner_user_id = eworks.current_user_id()
              and status in ('DRAFT', 'REJECTED')`,
        );
        if (vQ.rowCount === 0) throw new Error('save profile first');
        const vendorId = vQ.rows[0].id;
        const nablUntil = vQ.rows[0].nabl_valid_until;

        await client.query(`delete from eworks.vendor_test_capabilities where vendor_id = $1`, [vendorId]);
        let inserted = 0;
        for (const testId of testIds) {
          const tQ = await client.query(
            `select requires_nabl from eworks.test_catalog where id = $1 and is_active`,
            [testId],
          );
          if (tQ.rowCount === 0) continue;
          const requiresNabl = tQ.rows[0].requires_nabl;
          await client.query(
            `insert into eworks.vendor_test_capabilities
               (vendor_id, test_id, is_nabl_accredited, nabl_scope_ref, accredited_from, accredited_to)
             values ($1, $2, $3, $4, current_date - 30, $5)`,
            [
              vendorId,
              testId,
              requiresNabl,
              requiresNabl ? 'SCOPE-DEV' : null,
              requiresNabl ? nablUntil : null,
            ],
          );
          inserted += 1;
        }
        return inserted;
      });
      res.json({ inserted: count });
    } catch (err) {
      res.status(400).json({ error: 'capabilities_failed', detail: err.message });
    }
  });

  app.post('/api/vendor/onboarding/submit', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        const bundle = await fetchVendorOnboarding(client);
        if (!bundle.vendor) throw new Error('complete profile first');
        if (!['DRAFT', 'REJECTED'].includes(bundle.vendor.status)) {
          throw new Error('already submitted');
        }
        const uploaded = new Set(bundle.documents.map((d) => d.docType));
        for (const reqDoc of KYC_REQUIRED_DOCS) {
          if (!uploaded.has(reqDoc)) throw new Error(`missing document: ${reqDoc}`);
        }
        if (bundle.capabilities.length === 0) throw new Error('select at least one test capability');

        const q = await client.query(
          `update eworks.vendors set status = 'SUBMITTED', updated_at = now()
            where id = $1 and owner_user_id = eworks.current_user_id()
              and status in ('DRAFT', 'REJECTED')
            returning id, legal_name as "legalName", status`,
          [bundle.vendor.id],
        );
        if (q.rowCount === 0) throw new Error('submit failed');
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'submit_failed', detail: err.message });
    }
  });

  // --- vendor pricing (rate card) --------------------------------------------
  // The DB layer (20260709000900_pricing_integrity.sql) guarantees at most one
  // live price per (vendor, test, date) via a GiST exclusion constraint on
  // half-open [from, to) windows. These endpoints never delete history: a price
  // change closes the live window at the new boundary and opens the next one.

  function httpError(status, message) {
    const err = new Error(message);
    err.httpStatus = status;
    return err;
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Own vendor row + org path (for audit rows). RLS already limits the visible
  // vendors to the caller's own; the explicit owner filter keeps intent clear.
  async function resolveOwnVendor(client) {
    const q = await client.query(
      `select v.id, v.status, ou.path as "orgPath"
         from eworks.vendors v
         join eworks.org_units ou on ou.id = v.org_unit_id
        where v.owner_user_id = eworks.current_user_id()`,
    );
    return q.rows[0] ?? null;
  }

  app.get('/api/vendor/pricing', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        // security_invoker view: RLS scopes it to the caller's own vendor.
        // Unpriced capabilities come through the view's left join — they are
        // the vendor's to-do list, so they must appear here.
        const q = await client.query(
          `select test_id            as "testId",
                  test_code          as "testCode",
                  test_name          as "testName",
                  requires_nabl      as "requiresNabl",
                  is_qualified_today as "isQualifiedToday",
                  price_paise        as "currentPricePaise",
                  effective_from     as "effectiveFrom",
                  effective_to       as "effectiveTo",
                  is_priced_today    as "isPricedToday"
             from eworks.vendor_service_catalog
            order by is_priced_today, test_name`,
        );
        return q.rows;
      });
      res.json(rows.map((r) => ({
        ...r,
        currentPricePaise: r.currentPricePaise == null ? null : Number(r.currentPricePaise),
      })));
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.put('/api/vendor/pricing/:testId', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { pricePaise, effectiveFrom } = req.body || {};
    // Money is integer paise end-to-end: fractional paise is a client bug.
    if (!Number.isInteger(pricePaise) || pricePaise <= 0) {
      return res.status(400).json({ error: 'invalid_price', detail: 'pricePaise must be a positive integer' });
    }
    if (effectiveFrom != null && !DATE_RE.test(String(effectiveFrom))) {
      return res.status(400).json({ error: 'invalid_date', detail: 'effectiveFrom must be YYYY-MM-DD' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const vendor = await resolveOwnVendor(client);
        if (!vendor || vendor.status !== 'APPROVED') {
          throw httpError(403, 'only an approved vendor can publish prices');
        }
        const capQ = await client.query(
          `select 1 from eworks.vendor_test_capabilities
            where vendor_id = $1 and test_id = $2 and is_active`,
          [vendor.id, req.params.testId],
        );
        if (capQ.rowCount === 0) {
          throw httpError(403, 'no active capability for this test');
        }

        // The DB's calendar is authoritative — never trust the Node clock.
        const dateQ = await client.query(
          `select coalesce($1::date, current_date) as "from",
                  coalesce($1::date, current_date) < current_date as "inPast"`,
          [effectiveFrom ?? null],
        );
        const newFrom = dateQ.rows[0].from;
        if (dateQ.rows[0].inPast) {
          throw httpError(400, 'effectiveFrom must not be in the past');
        }

        // A future-dated window would overlap the new open-ended one. Naming
        // it beats letting the exclusion constraint abort the transaction —
        // and we must never silently delete a future window.
        const conflictQ = await client.query(
          `select effective_from::text as "from", effective_to::text as "to"
             from eworks.vendor_test_pricing
            where vendor_id = $1 and test_id = $2 and effective_from > $3::date
            order by effective_from limit 1`,
          [vendor.id, req.params.testId, newFrom],
        );
        if (conflictQ.rowCount > 0) {
          const w = conflictQ.rows[0];
          throw httpError(409,
            `a price window starting ${w.from} (until ${w.to ?? 'open-ended'}) already exists; ` +
            'change or stop that window first');
        }

        // Close the live window at the boundary, then open the new one.
        // Half-open [from, to) means no one-day hole and no one-day overlap.
        const closedQ = await client.query(
          `update eworks.vendor_test_pricing
              set effective_to = $3::date
            where vendor_id = $1 and test_id = $2 and effective_range @> $3::date
            returning effective_from as "from"`,
          [vendor.id, req.params.testId, newFrom],
        );
        const insertQ = await client.query(
          `insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from)
           values ($1, $2, $3, $4::date)
           returning id, price_paise as "pricePaise", effective_from as "effectiveFrom", effective_to as "effectiveTo"`,
          [vendor.id, req.params.testId, pricePaise, newFrom],
        );
        const created = insertQ.rows[0];

        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'vendor.price_set', 'vendor_test_pricing', $1, $2,
                   jsonb_build_object('test_id', $3::uuid, 'price_paise', $4::bigint,
                                      'effective_from', $5::date, 'closed_previous', $6::boolean))`,
          [created.id, vendor.orgPath, req.params.testId, pricePaise, newFrom, closedQ.rowCount > 0],
        );
        return { ...created, pricePaise: Number(created.pricePaise) };
      });
      res.json(row);
    } catch (err) {
      // Safety net: a concurrent writer can still trip the exclusion
      // constraint between our pre-check and the insert.
      if (err.code === '23P01') {
        return res.status(409).json({ error: 'price_window_conflict', detail: 'an overlapping price window already exists' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'price_set_failed', detail: err.message });
    }
  });

  app.get('/api/vendor/pricing/:testId/history', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        // RLS makes this the caller's own windows only. Empty windows (closed
        // at their own start by a same-day reprice) carry no information.
        const q = await client.query(
          `select price_paise    as "pricePaise",
                  effective_from as "effectiveFrom",
                  effective_to   as "effectiveTo"
             from eworks.vendor_test_pricing
            where test_id = $1 and not isempty(effective_range)
            order by effective_from desc`,
          [req.params.testId],
        );
        return q.rows;
      });
      res.json(rows.map((r) => ({ ...r, pricePaise: Number(r.pricePaise) })));
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.delete('/api/vendor/pricing/:testId', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const closed = await withUserSession(userId, async (client) => {
        const vendor = await resolveOwnVendor(client);
        if (!vendor) throw httpError(403, 'no vendor on this account');
        // Stop offering: close the live window today. History stays — it is
        // evidence, so there is no hard delete on this table from the app.
        const q = await client.query(
          `update eworks.vendor_test_pricing
              set effective_to = current_date
            where vendor_id = $1 and test_id = $2 and effective_range @> current_date
            returning id, effective_from as "effectiveFrom"`,
          [vendor.id, req.params.testId],
        );
        if (q.rowCount === 0) return null;
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'vendor.price_stop', 'vendor_test_pricing', $1, $2,
                   jsonb_build_object('test_id', $3::uuid))`,
          [q.rows[0].id, vendor.orgPath, req.params.testId],
        );
        return q.rows[0];
      });
      if (!closed) return res.status(404).json({ error: 'no_live_price' });
      res.json({ stopped: true, effectiveTo: null, closedWindowFrom: closed.effectiveFrom });
    } catch (err) {
      res.status(err.httpStatus ?? 400).json({ error: 'price_stop_failed', detail: err.message });
    }
  });

  // Officer view of a vendor's current rate card. RLS keeps the pricing ROWS
  // owner-only (an officer must not browse window history), but the current
  // effective price is exposed through the security-definer helpers the bid
  // gate itself uses. Scope is enforced by the vendors_read policy: a vendor
  // outside the officer's scope is invisible, so this 404s like the detail
  // route. Read-only by construction — there is no officer write path.
  app.get('/api/gov/vendors/:id/pricing', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const vQ = await client.query(
          `select 1 from eworks.vendors where id = $1`,
          [req.params.id],
        );
        if (vQ.rowCount === 0) return null;
        const q = await client.query(
          `select tc.id            as "testId",
                  tc.code          as "testCode",
                  tc.name          as "testName",
                  tc.requires_nabl as "requiresNabl",
                  eworks.vendor_qualified_for($1, tc.id)  as "isQualifiedToday",
                  eworks.vendor_effective_price($1, tc.id) as "currentPricePaise"
             from eworks.vendor_test_capabilities c
             join eworks.test_catalog tc on tc.id = c.test_id
            where c.vendor_id = $1 and c.is_active
            order by tc.name`,
          [req.params.id],
        );
        return q.rows;
      });
      if (!rows) return res.status(404).json({ error: 'vendor_not_found' });
      res.json(rows.map((r) => ({
        ...r,
        currentPricePaise: r.currentPricePaise == null ? null : Number(r.currentPricePaise),
        isPricedToday: r.currentPricePaise != null,
      })));
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/kyc/files/:vendorId/:docType', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const meta = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select d.storage_path as "storagePath", d.mime_type as "mimeType"
             from eworks.vendor_documents d
             join eworks.vendors v on v.id = d.vendor_id
            where d.vendor_id = $1 and d.doc_type = $2::eworks.vendor_doc_type`,
          [req.params.vendorId, req.params.docType],
        );
        return q.rows[0] ?? null;
      });
      if (!meta) return res.status(404).json({ error: 'not_found' });
      const bytes = await readKycDocument(meta.storagePath);
      res.setHeader('Content-Type', meta.mimeType);
      res.send(bytes);
    } catch (err) {
      res.status(404).json({ error: 'file_not_found', detail: err.message });
    }
  });

  app.post('/api/gov/vendors/:id/documents/:docType/review', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { decision, reason } = req.body || {};
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'decision must be approve or reject' });
    }
    if (decision === 'reject' && !reason?.trim()) {
      return res.status(400).json({ error: 'reject reason required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          decision === 'approve'
            ? `update eworks.vendor_documents d
                  set status = 'APPROVED',
                      reviewed_by = eworks.current_user_id(),
                      reviewed_at = now(),
                      reject_reason = null
                from eworks.vendors v
               where d.vendor_id = v.id and v.id = $1
                 and d.doc_type = $2::eworks.vendor_doc_type
                 and d.status = 'PENDING'
               returning d.doc_type as "docType", d.status`
            : `update eworks.vendor_documents d
                  set status = 'REJECTED',
                      reviewed_by = eworks.current_user_id(),
                      reviewed_at = now(),
                      reject_reason = $3
                from eworks.vendors v
               where d.vendor_id = v.id and v.id = $1
                 and d.doc_type = $2::eworks.vendor_doc_type
                 and d.status = 'PENDING'
               returning d.doc_type as "docType", d.status`,
          [req.params.id, req.params.docType, reason?.trim() ?? null],
        );
        if (q.rowCount === 0) throw new Error('document not found or not pending');
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'doc_review_failed', detail: err.message });
    }
  });

  // ===========================================================================
  // Contractor portal — registration/KYC (mirrors vendor onboarding) + contracts
  // ===========================================================================
  async function fetchContractorOnboarding(client) {
    const cQ = await client.query(
      `select c.id, c.legal_name as "legalName", c.gstin, c.pan, c.address,
              c.licence_class as "licenceClass", c.licence_no as "licenceNo",
              c.status, ou.name as "districtName"
         from eworks.contractors c
         join eworks.org_units ou on ou.id = c.org_unit_id
        where c.owner_user_id = eworks.current_user_id()
        limit 1`,
    );
    const contractor = cQ.rows[0] ?? null;
    if (!contractor) return { contractor: null, documents: [] };

    const docsQ = await client.query(
      `select id, doc_type as "docType", status, mime_type as "mimeType",
              storage_path as "storagePath", reject_reason as "rejectReason"
         from eworks.contractor_documents
        where contractor_id = $1
        order by doc_type`,
      [contractor.id],
    );
    return { contractor, documents: docsQ.rows };
  }

  app.get('/api/contractor/onboarding', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, (client) => fetchContractorOnboarding(client));
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/contractor/onboarding/profile', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { legalName, gstin, pan, address, licenceClass, licenceNo } = req.body || {};
    if (!legalName || !gstin || !pan || !address || !licenceClass || !licenceNo) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        const districtQ = await client.query(
          `select ur.org_unit_id as id
             from eworks.user_roles ur
            where ur.user_id = eworks.current_user_id()
              and ur.role_code = 'CONTRACTOR'
            limit 1`,
        );
        const districtId = districtQ.rows[0]?.id;
        if (!districtId) throw new Error('no CONTRACTOR district on account');

        const existingQ = await client.query(
          `select id, status from eworks.contractors where owner_user_id = eworks.current_user_id()`,
        );
        const existing = existingQ.rows[0];
        if (existing && !['DRAFT', 'REJECTED'].includes(existing.status)) {
          throw new Error('contractor profile is locked after submission');
        }

        const params = [
          legalName.trim(),
          gstin.trim().toUpperCase(),
          pan.trim().toUpperCase(),
          address.trim(),
          licenceClass.trim(),
          licenceNo.trim(),
          districtId,
        ];

        if (existing) {
          const u = await client.query(
            `update eworks.contractors
                set legal_name = $1, gstin = $2, pan = $3, address = $4,
                    licence_class = $5, licence_no = $6, org_unit_id = $7, updated_at = now()
              where id = $8 and owner_user_id = eworks.current_user_id()
                and status in ('DRAFT', 'REJECTED')
            returning id, status`,
            [...params, existing.id],
          );
          if (u.rowCount === 0) throw new Error('update failed — check contractor status');
          return u.rows[0];
        }

        const i = await client.query(
          `insert into eworks.contractors
             (owner_user_id, org_unit_id, legal_name, gstin, pan, address, licence_class, licence_no, status)
           values (eworks.current_user_id(), $7, $1, $2, $3, $4, $5, $6, 'DRAFT')
           returning id, status`,
          params,
        );
        return i.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'profile_failed', detail: err.message });
    }
  });

  app.post('/api/contractor/onboarding/documents', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { docType, dataUrl, mimeType } = req.body || {};
    if (!docType || !dataUrl) return res.status(400).json({ error: 'docType and dataUrl required' });
    if (!CONTRACTOR_DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'invalid_doc_type' });
    try {
      const row = await withUserSession(userId, async (client) => {
        const cQ = await client.query(
          `select id from eworks.contractors
            where owner_user_id = eworks.current_user_id() and status in ('DRAFT', 'REJECTED')`,
        );
        if (cQ.rowCount === 0) throw new Error('save profile first');
        const contractorId = cQ.rows[0].id;

        const saved = await saveContractorDocument(contractorId, docType, dataUrl, mimeType);
        await client.query(
          `delete from eworks.contractor_documents where contractor_id = $1 and doc_type = $2::eworks.contractor_doc_type`,
          [contractorId, docType],
        );
        const q = await client.query(
          `insert into eworks.contractor_documents
             (contractor_id, doc_type, storage_path, mime_type, sha256, scanned_clean, status)
           values ($1, $2::eworks.contractor_doc_type, $3, $4, $5, true, 'PENDING')
           returning id, doc_type as "docType", status, mime_type as "mimeType", storage_path as "storagePath"`,
          [contractorId, docType, saved.storagePath, saved.mimeType, saved.sha256],
        );
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'upload_failed', detail: err.message });
    }
  });

  app.post('/api/contractor/onboarding/submit', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        const bundle = await fetchContractorOnboarding(client);
        if (!bundle.contractor) throw new Error('complete profile first');
        if (!['DRAFT', 'REJECTED'].includes(bundle.contractor.status)) throw new Error('already submitted');
        const uploaded = new Set(bundle.documents.map((d) => d.docType));
        for (const reqDoc of CONTRACTOR_REQUIRED_DOCS) {
          if (!uploaded.has(reqDoc)) throw new Error(`missing document: ${reqDoc}`);
        }
        const q = await client.query(
          `update eworks.contractors set status = 'SUBMITTED', updated_at = now()
            where id = $1 and owner_user_id = eworks.current_user_id()
              and status in ('DRAFT', 'REJECTED')
            returning id, legal_name as "legalName", status`,
          [bundle.contractor.id],
        );
        if (q.rowCount === 0) throw new Error('submit failed');
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'submit_failed', detail: err.message });
    }
  });

  app.get('/api/contractor/files/:contractorId/:docType', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const meta = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select d.storage_path as "storagePath", d.mime_type as "mimeType"
             from eworks.contractor_documents d
            where d.contractor_id = $1 and d.doc_type = $2::eworks.contractor_doc_type`,
          [req.params.contractorId, req.params.docType],
        );
        return q.rows[0] ?? null;
      });
      if (!meta) return res.status(404).json({ error: 'not_found' });
      const bytes = await readContractorDocument(meta.storagePath);
      res.setHeader('Content-Type', meta.mimeType);
      res.send(bytes);
    } catch (err) {
      res.status(404).json({ error: 'file_not_found', detail: err.message });
    }
  });

  // Contracts a contractor may see (RLS): open FLOATED ones to bid on, plus any
  // they hold. Includes their own current bid, if placed.
  app.get('/api/contractor/contracts', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select c.id, c.code, c.title, c.value_paise as "valuePaise", c.status,
                  ou.name as "projectName",
                  b.amount_paise as "myBidPaise", b.submitted_at as "myBidAt"
             from eworks.contracts c
             left join eworks.org_units ou on ou.id = c.project_id
             left join eworks.contract_bids b
               on b.contract_id = c.id
              and b.contractor_id = (select id from eworks.contractors
                                      where owner_user_id = eworks.current_user_id())
            where c.status in ('FLOATED', 'AWARDED')
            order by (c.status = 'FLOATED') desc, c.created_at desc`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.post('/api/contractor/contracts/:id/bid', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { amountPaise } = req.body || {};
    const amount = Number(amountPaise);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'invalid_amount' });
    try {
      const row = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `insert into eworks.contract_bids (contract_id, contractor_id, amount_paise)
           select $1, ctr.id, $2
             from eworks.contractors ctr
            where ctr.owner_user_id = eworks.current_user_id() and ctr.status = 'APPROVED'
              and exists (select 1 from eworks.contracts c where c.id = $1 and c.status = 'FLOATED')
           on conflict (contract_id, contractor_id)
             do update set amount_paise = excluded.amount_paise, submitted_at = now()
           returning id, amount_paise as "amountPaise"`,
          [req.params.id, Math.round(amount)],
        );
        if (q.rowCount === 0) throw new Error('cannot bid — contract not open or contractor not approved');
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      res.status(400).json({ error: 'bid_failed', detail: err.message });
    }
  });

  // Terminal error handler — must be registered after all routes/middleware
  registerAdminRoutes(app, { requireUser, withUserSession });

  // (Express only recognizes 4-arg handlers here). Catches anything forwarded
  // by Express, including rejected async handlers, so stack traces never leak.
  app.use(errorHandler(config));

  return app;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const config = loadConfig();
  if (config.isProd && config.provider === 'console') {
    console.warn('[bff] WARNING: OTP_PROVIDER=console in production — codes are only logged, not delivered. Set OTP_PROVIDER=msg91 before real users.');
  }
  if (config.isProd && !config.mfaEnabled) {
    console.warn('[bff] WARNING: MFA_ENABLED=false in production — government roles log in with OTP only. Remove MFA_ENABLED=false before real users.');
  }
  if (process.env.DEMO_MODE === 'true' && !config.demoMode) {
    console.warn('[bff] DEMO_MODE=true ignored: demo mode is never allowed in production.');
  }
  const app = createApp(config);
  app.listen(config.port, () => console.log(`BFF (${config.env}) listening on http://127.0.0.1:${config.port}`));
}
