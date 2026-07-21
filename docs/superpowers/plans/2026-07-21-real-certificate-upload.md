# Real Certificate Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fabricated certificate hash with a real PDF the lab uploads; store it, record its true `sha256`, and let the vendor, gov officers, and the public verify page open the actual document.

**Architecture:** A disk-storage module mirrors `checkin-photo.mjs`/`kyc-upload.mjs`. The vendor certificate POST takes the PDF (base64) and hashes it server-side. Three GET routes stream the stored PDF — vendor (RLS), gov (`order.read`), and public (by cert id). The frontend swaps the dev button for a PDF picker and adds download links on the vendor job, gov fulfillment, and public verify. No migration.

**Tech Stack:** Node + Express 5 (`pg`), React 19 + TS, TanStack Query, react-i18next, Vitest + RTL. Working dir for `npm`/`node`: `web/`.

## Global Constraints

- **No migration.** `certificates.storage_path` + `.sha256` already exist. Works against remote too (no DB change).
- **PDF only**, validated by `%PDF` magic bytes; 5 MB cap; store to `web/server/dev-uploads/certificates/<jobId>.pdf`.
- Stored `certificates.sha256` MUST equal `sha256(pdf bytes)` — server-computed; never a client hash.
- Signature verification is unchanged (separate gov step).
- All user-facing strings in `en.json` + `ta.json`, keys identical.
- DoD: `npm run test`, `npm run lint`, `npx tsc -b` green; flow works in the app.

## File Structure

- `web/server/certificate-file.mjs` *(create)* — `saveCertificate`, `readCertificate`.
- `web/server/certificate-file.test.mjs` *(create)* — unit tests (no DB).
- `web/server/bff.mjs` *(modify)* — cert POST takes `file`; vendor/gov/public PDF GET routes.
- `web/src/features/jobs/api.ts`, `useJobs.ts` *(modify)* — upload takes `file`; `certificateFileUrl`.
- `web/src/features/jobs/JobDetailPage.tsx` *(modify)* — PDF picker; view link.
- `web/src/lib/photoHash.ts` *(delete)* — unused after this (cert stub was its last user).
- `web/src/features/gov/GovOrderFulfillment.tsx` *(modify)* — download link.
- `web/src/features/public/VerifyCertificatePage.tsx` *(modify)* — download link.
- `web/src/i18n/en.json`, `ta.json` *(modify)* — cert file strings.
- `web/src/features/jobs/JobDetailPage.test.tsx` *(modify)* — cert upload test.

---

## Task 1: Storage module + unit test

**Files:**
- Create: `web/server/certificate-file.mjs`
- Create: `web/server/certificate-file.test.mjs`

**Interfaces:**
- Produces: `saveCertificate(jobId, base64DataUrl) -> Promise<{ sha256: Buffer, storagePath: string }>`; `readCertificate(jobId) -> Promise<Buffer|null>`.

- [ ] **Step 1: Write the failing unit test** `web/server/certificate-file.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { saveCertificate } from './certificate-file.mjs';

const pdfDataUrl = (body = 'hello') =>
  `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n${body}\n%%EOF`).toString('base64')}`;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('certificate-file', () => {
  it('stores a PDF and returns its true sha256 + path', async () => {
    const jobId = '00000000-0000-0000-0000-0000000000c1';
    const { sha256, storagePath } = await saveCertificate(jobId, pdfDataUrl());
    expect(storagePath).toBe(`dev/certificates/${jobId}.pdf`);
    const bytes = Buffer.from(`%PDF-1.4\nhello\n%%EOF`);
    expect(sha256.equals(createHash('sha256').update(bytes).digest())).toBe(true);
    expect(sha256.length).toBe(32);
  });

  it('rejects a non-PDF payload', async () => {
    await expect(saveCertificate('00000000-0000-0000-0000-0000000000c2', PNG))
      .rejects.toThrow(/not a PDF/i);
  });

  it('rejects empty', async () => {
    await expect(saveCertificate('00000000-0000-0000-0000-0000000000c3', 'data:application/pdf;base64,'))
      .rejects.toThrow(/empty/);
  });

  it('rejects a non-uuid job id', async () => {
    await expect(saveCertificate('../evil', pdfDataUrl())).rejects.toThrow(/invalid job id/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/certificate-file.test.mjs`
Expected: FAIL — `Cannot find module './certificate-file.mjs'`.

- [ ] **Step 3: Implement `web/server/certificate-file.mjs`**

```js
// Dev-only certificate PDF storage on local disk (production -> Supabase Storage).
// Mirrors checkin-photo.mjs. The stored sha256 is computed here from the actual
// bytes, so the public verify hash is a genuine integrity proof.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dev-uploads', 'certificates');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !UUID.test(jobId)) throw new Error('invalid job id');
}

function isPdf(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function saveCertificate(jobId, base64DataUrl) {
  assertJobId(jobId);
  const match = /^data:([^;]+);base64,(.*)$/s.exec(base64DataUrl ?? '');
  const bytes = Buffer.from(match?.[2] ?? '', 'base64');
  if (bytes.length === 0) throw new Error('empty certificate');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('certificate too large (max 5 MB)');
  if (!isPdf(bytes)) throw new Error('not a PDF');

  const abs = join(ROOT, `${jobId}.pdf`);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);

  const sha256 = createHash('sha256').update(bytes).digest();
  return { sha256, storagePath: `dev/certificates/${jobId}.pdf` };
}

export async function readCertificate(jobId) {
  assertJobId(jobId);
  try {
    return await readFile(join(ROOT, `${jobId}.pdf`));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run to green**

Run: `npx vitest run server/certificate-file.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/certificate-file.mjs web/server/certificate-file.test.mjs
git commit -m "feat(jobs): certificate PDF disk storage module"
```

---

## Task 2: BFF — cert POST takes a PDF; vendor/gov/public download routes

**Files:**
- Modify: `web/server/bff.mjs`

**Interfaces:**
- Modifies `POST /api/vendor/jobs/:id/certificate` body `{ file }`.
- Produces `GET /api/vendor/jobs/:id/certificate/file`, `GET /api/gov/orders/:id/certificate/file`, `GET /api/public/certificates/:id/file`.

- [ ] **Step 1: Add the import**

After the `checkin-photo.mjs` import (~line 17):

```js
import { saveCertificate, readCertificate } from './certificate-file.mjs';
```

- [ ] **Step 2: Rewrite the certificate POST to take a PDF file**

Replace the `POST /api/vendor/jobs/:id/certificate` handler body:

```js
  app.post('/api/vendor/jobs/:id/certificate', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { file } = req.body || {};
    if (!file) return res.status(400).json({ error: 'file_required' });
    try {
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
```

- [ ] **Step 3: Add the gov download route**

Next to the gov `checkin-photo` route (which already has the `order.read` gate to copy):

```js
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
```

- [ ] **Step 4: Add the public download route**

Next to `GET /api/public/certificates/:id` (uses `pool` directly, no auth):

```js
  app.get('/api/public/certificates/:id/file', async (req, res) => {
    try {
      const q = await pool.query(`select job_id as "jobId" from eworks.certificates where id = $1`, [req.params.id]);
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
```

- [ ] **Step 5: Restart BFF (local DB) + smoke wiring**

```bash
# kill listener on 8787, then:
EWORKS_USE_LOCAL_PG=1 node server/bff.mjs & sleep 3
curl -s -o /dev/null -w "cert POST no-body: %{http_code}\n" -X POST http://127.0.0.1:8787/api/vendor/jobs/x/certificate -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w "vendor cert file no-auth: %{http_code}\n" http://127.0.0.1:8787/api/vendor/jobs/x/certificate/file
curl -s -o /dev/null -w "public cert file missing: %{http_code}\n" http://127.0.0.1:8787/api/public/certificates/00000000-0000-0000-0000-000000000000/file
```
Expected: `401`, `401`, `404`.

- [ ] **Step 6: Server tests + lint**

Run: `npx vitest run server/bff.test.mjs server/certificate-file.test.mjs && npx oxlint server/bff.mjs server/certificate-file.mjs`
Expected: PASS; no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add web/server/bff.mjs
git commit -m "feat(jobs): certificate upload stores a real PDF; vendor/gov/public download"
```

---

## Task 3: Frontend api/hook + vendor PDF picker

**Files:**
- Modify: `web/src/features/jobs/api.ts`, `web/src/features/jobs/JobDetailPage.tsx`
- Delete: `web/src/lib/photoHash.ts`

**Interfaces:**
- Produces: `uploadJobCertificate(jobId, { file })`; `certificateFileUrl(jobId)`.

- [ ] **Step 1: Update `web/src/features/jobs/api.ts`**

```ts
export function uploadJobCertificate(jobId: string, body: { file: string }) {
  return apiClient.post(`/api/vendor/jobs/${jobId}/certificate`, body);
}

export function certificateFileUrl(jobId: string) {
  return `/api/vendor/jobs/${jobId}/certificate/file`;
}
```

- [ ] **Step 2: Update `web/src/features/jobs/JobDetailPage.tsx`**

Remove the `randomPhotoSha256Hex` import; add `certificateFileUrl` to the `./api` import (which already imports `checkinPhotoUrl`):

```tsx
import { checkinPhotoUrl, certificateFileUrl } from './api';
```

Add a file reader helper (near the top of the file, module scope):

```tsx
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
```

Add a cert file input ref alongside the photo ref:

```tsx
  const certRef = useRef<HTMLInputElement>(null);
```

Replace `handleUploadCertificate` (which used `randomPhotoSha256Hex`) with:

```tsx
  async function onPickCertificate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setActionError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await uploadCert.mutateAsync({ file: dataUrl });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('results.certFailed'));
    }
  }
```

Replace the upload-cert `<button>` block (`allResultsEntered && !job.certificate`) with a PDF picker:

```tsx
      {allResultsEntered && !job.certificate && (
        <div className="gov-card mt-8 border-l-4 border-l-navy p-6">
          <h3 className="font-display text-lg font-bold">{t('results.uploadCert')}</h3>
          <p className="mt-2 text-sm text-ink-2">{t('results.uploadCertBody')}</p>
          <input
            ref={certRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => void onPickCertificate(e)}
          />
          <button
            type="button"
            className="gov-btn-primary mt-4"
            disabled={uploadCert.isPending}
            onClick={() => certRef.current?.click()}
          >
            {uploadCert.isPending ? t('states.loading') : t('results.pickCert')}
          </button>
        </div>
      )}
```

In the `job.certificate` confirmation block, replace the raw `storagePath` line with a view link:

```tsx
          <a
            href={certificateFileUrl(id)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-sm font-semibold text-navy hover:underline"
          >
            {t('results.viewCert')}
          </a>
```

- [ ] **Step 3: Delete `web/src/lib/photoHash.ts`**

```bash
git rm web/src/lib/photoHash.ts
```
(`JobDetailPage` was its last importer; `tsc -b` in Task 4 confirms none remain.)

- [ ] **Step 4: Commit with Task 4** — this file still needs i18n keys and the test; commit together in Task 4 to keep the tree green.

---

## Task 4: i18n + gov/public download links + test + green

**Files:**
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json`
- Modify: `web/src/features/gov/GovOrderFulfillment.tsx`, `web/src/features/public/VerifyCertificatePage.tsx`
- Modify: `web/src/features/jobs/JobDetailPage.test.tsx`

- [ ] **Step 1: i18n keys**

en.json under `results`: `"pickCert": "Upload certificate (PDF)"`, `"viewCert": "View certificate"`.
en.json under `fulfillment`: `"downloadCert": "Download PDF"`.
en.json under `verify`: `"downloadCert": "Download certificate PDF"`.

ta.json under `results`: `"pickCert": "சான்றிதழைப் பதிவேற்று (PDF)"`, `"viewCert": "சான்றிதழைப் பார்"`.
ta.json under `fulfillment`: `"downloadCert": "PDF பதிவிறக்கு"`.
ta.json under `verify`: `"downloadCert": "சான்றிதழ் PDF பதிவிறக்கு"`.

- [ ] **Step 2: Gov fulfillment download link** — in `GovOrderFulfillment.tsx`, inside the certificate card, after the `signatureVerified` `<p>` and before the verify button, add:

```tsx
              <a
                href={`/api/gov/orders/${orderId}/certificate/file`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-xs font-semibold text-navy hover:underline"
              >
                {t('fulfillment.downloadCert')}
              </a>
```

- [ ] **Step 3: Public verify download link** — in `VerifyCertificatePage.tsx`, inside `VerifyResult`, after the sha256 `<dl>` closes (before the footnote `<p>`), add:

```tsx
      <a
        href={`/api/public/certificates/${certId}/file`}
        target="_blank"
        rel="noreferrer"
        className="mx-auto block text-center text-sm font-semibold text-navy hover:underline"
      >
        {t('verify.downloadCert')}
      </a>
```

- [ ] **Step 4: Update `web/src/features/jobs/JobDetailPage.test.tsx`**

The existing test file mocks `./api`; add `uploadJobCertificate` to the mock and a cert-upload case. Add to the `vi.mock('./api', ...)` return object:
```tsx
  uploadJobCertificate: vi.fn(async () => ({ id: 'cert-1' })),
```
Then append a test (a job with all results entered and no certificate — reuse a fixture shaped like the check-in test's `job`, but with `status: 'TESTING'`/results present so `allResultsEntered && !job.certificate`; if that state is hard to construct, assert the simpler invariant that a `application/pdf` file input exists and uploading calls `uploadJobCertificate` with a `file`):

```tsx
  it('uploads a chosen PDF certificate', async () => {
    // job fixture where the certificate step is shown:
    vi.mocked(api.fetchFieldJob).mockResolvedValue({ ...job, /* ensure allResultsEntered && !certificate */ } as never);
    renderPage();
    const input = document.querySelector('input[accept="application/pdf"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'c.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, pdf);
    await waitFor(() => expect(api.uploadJobCertificate).toHaveBeenCalled());
    const body = vi.mocked(api.uploadJobCertificate).mock.calls[0][1];
    expect(typeof body.file).toBe('string');
  });
```
Note: constructing `allResultsEntered` depends on `JobDetailPage`'s logic — inspect how it is derived (it keys off the job's items/samples/results). Build the fixture to satisfy it; if the panel is gated behind result entry that's awkward to mock, instead render with a job that already has results and no certificate. Keep the assertion focused on the input + the `file` field.

- [ ] **Step 5: Run the jobs test, then typecheck + lint**

Run: `npx vitest run src/features/jobs/JobDetailPage.test.tsx`
Expected: PASS.
Run: `npx tsc -b && npx oxlint src/features/jobs src/features/gov/GovOrderFulfillment.tsx src/features/public/VerifyCertificatePage.tsx`
Expected: clean (confirms `photoHash.ts` had no remaining importers).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/jobs web/src/features/gov/GovOrderFulfillment.tsx web/src/features/public/VerifyCertificatePage.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(jobs): real certificate PDF upload + vendor/gov/public download links"
```

---

## Task 5: Full green + live verification

**Files:** none.

- [ ] **Step 1: Full suite, lint, tsc**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: all green.

- [ ] **Step 2: i18n parity**

Run: `node -e "const a=require('./src/i18n/en.json'),b=require('./src/i18n/ta.json');const k=o=>Object.keys(o).flatMap(x=>o[x]&&typeof o[x]==='object'?k(o[x]).map(y=>x+'.'+y):[x]);const ka=new Set(k(a)),kb=new Set(k(b));const miss=[...ka].filter(x=>!kb.has(x)).concat([...kb].filter(x=>!ka.has(x)));console.log(miss.length?('MISMATCH: '+miss.join(', ')):'i18n keys match');"`
Expected: `i18n keys match`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: builds.

- [ ] **Step 4: Live check (local DB)**

BFF with `EWORKS_USE_LOCAL_PG=1` + Vite. Drive a job to results-entered (or reuse one), upload a small PDF via the picker, confirm "View certificate" opens the PDF. As a gov officer, open the order fulfillment → "Download PDF" opens it. On the public verify page for that cert id, "Download certificate PDF" opens it, and the shown `sha256Hex` matches `sha256` of the downloaded bytes.

- [ ] **Step 5: Final commit (if fixups)**

```bash
git add -A && git commit -m "chore(jobs): certificate upload verification"
```

---

## Self-Review

**Spec coverage:**
- Storage (PDF magic-byte validate, 5 MB cap, uuid guard, real sha256 + path) → Task 1. ✅
- Cert POST takes a PDF, server hashes → Task 2 Step 2. ✅
- Vendor / gov / public download routes → Task 2 Steps 2–4. ✅
- Vendor PDF picker + view link → Task 3. ✅
- Gov + public download links → Task 4 Steps 2–3. ✅
- i18n en/ta → Task 4 Step 1. ✅
- Unit + RTL tests, no-file 400 smoke → Tasks 1, 2, 4. ✅
- No migration; local-only live check → Global Constraints + Task 5 Step 4. ✅

**Placeholder scan:** No TBD/TODO in shipped code. The Task 4 Step 4 test note deliberately defers the exact `allResultsEntered` fixture to inspection of `JobDetailPage` — the derivation is component-local and must be read, not guessed; the assertion (PDF input present + `file` field sent) is fixed.

**Type consistency:** `uploadJobCertificate(jobId, { file })` matches the handler (`req.body.file`) and the UI/test call sites. `certificateFileUrl(jobId)` is defined in api (Task 3) and used in the confirmation block (Task 3). `saveCertificate` returns `{ sha256, storagePath }` consumed in the handler (Task 2) and asserted in the unit test (Task 1). `photoHash.ts` is removed (Task 3) after its last importer drops it (Task 3); `tsc -b` (Task 4 Step 5) verifies no dangling import.
