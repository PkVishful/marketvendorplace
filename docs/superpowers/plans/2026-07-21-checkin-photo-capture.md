# Check-in Photo Capture + Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fabricated check-in photo hash with a real photo the technician captures/selects; store the image, record its true hash, and let the vendor and a gov officer view it.

**Architecture:** A new disk-storage module mirrors `kyc-upload.mjs`. The vendor check-in route now takes the image (base64) and hashes it server-side. Two GET routes stream the stored photo — one vendor-scoped, one gov-scoped. The frontend adds camera/file capture with client-side canvas downscale, a preview, and photo display on both the vendor job confirmation and the gov fulfillment view. No migration.

**Tech Stack:** Node + Express 5 (`pg`), React 19 + TS, TanStack Query, react-i18next, Vitest + RTL. Working dir for `npm`/`node`: `web/`.

## Global Constraints

- **No migration; local Docker Postgres** (`127.0.0.1:5433`) for any DB-touching test. Do not change the shared remote schema.
- Photo is **mandatory** for check-in.
- Store to `web/server/dev-uploads/checkins/<jobId>` (disk), like KYC. Cap 5 MB decoded; `express.json` limit is `6mb`, and the client downscales so payloads are small.
- The stored `site_checkins.photo_sha256` MUST equal `sha256(image bytes)` — the server computes it; never trust a client hash.
- All user-facing strings in `en.json` + `ta.json`, keys identical.
- DoD: `npm run test`, `npm run lint`, `npx tsc -b` green; flow works in the running app.

## File Structure

- `web/server/checkin-photo.mjs` *(create)* — `saveCheckinPhoto`, `readCheckinPhoto`, `sniffImageType`.
- `web/server/checkin-photo.test.mjs` *(create)* — unit tests (no DB).
- `web/server/bff.mjs` *(modify)* — check-in takes `photo`; vendor + gov photo GET routes.
- `web/src/lib/photoCapture.ts` *(create)* — `downscaleToJpegDataUrl`.
- `web/src/lib/photoHash.ts` *(delete)* — no longer used.
- `web/src/features/jobs/api.ts`, `useJobs.ts` *(modify)* — check-in body uses `photo`; `checkinPhotoUrl`.
- `web/src/features/jobs/JobDetailPage.tsx` *(modify)* — capture UI + preview + confirmation photo.
- `web/src/features/jobs/JobDetailPage.test.tsx` *(create)* — RTL for the capture gate.
- `web/src/features/gov/GovOrderFulfillment.tsx` *(modify)* — site-photo card.
- `web/src/i18n/en.json`, `ta.json` *(modify)* — jobs + fulfillment photo strings.

---

## Task 1: Storage module + unit test

**Files:**
- Create: `web/server/checkin-photo.mjs`
- Create: `web/server/checkin-photo.test.mjs`

**Interfaces:**
- Produces: `saveCheckinPhoto(jobId, base64DataUrl) -> Promise<{ sha256: Buffer, bytes: Buffer }>`; `readCheckinPhoto(jobId) -> Promise<Buffer|null>`; `sniffImageType(bytes) -> string`.

- [ ] **Step 1: Write the failing unit test** `web/server/checkin-photo.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { saveCheckinPhoto, sniffImageType } from './checkin-photo.mjs';

// 1x1 transparent PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('checkin-photo', () => {
  it('stores bytes and returns their true sha256', async () => {
    const { sha256, bytes } = await saveCheckinPhoto('00000000-0000-0000-0000-0000000000aa', PNG);
    expect(bytes.length).toBeGreaterThan(0);
    expect(sha256.equals(createHash('sha256').update(bytes).digest())).toBe(true);
    expect(sha256.length).toBe(32);
  });

  it('rejects an empty payload', async () => {
    await expect(saveCheckinPhoto('00000000-0000-0000-0000-0000000000ab', 'data:image/png;base64,'))
      .rejects.toThrow(/empty/);
  });

  it('rejects a non-uuid job id (path traversal guard)', async () => {
    await expect(saveCheckinPhoto('../evil', PNG)).rejects.toThrow(/invalid job id/);
  });

  it('sniffs image content types', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffImageType(Buffer.from([0x00, 0x01]))).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/checkin-photo.test.mjs`
Expected: FAIL — `Cannot find module './checkin-photo.mjs'`.

- [ ] **Step 3: Implement `web/server/checkin-photo.mjs`**

```js
// Dev-only check-in photo storage on local disk (production -> Supabase Storage).
// Mirrors kyc-upload.mjs. The file is addressed by job id; the authoritative
// sha256 is computed here from the actual bytes and recorded on the check-in.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dev-uploads', 'checkins');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !UUID.test(jobId)) throw new Error('invalid job id');
}

export async function saveCheckinPhoto(jobId, base64DataUrl) {
  assertJobId(jobId);
  const match = /^data:([^;]+);base64,(.*)$/s.exec(base64DataUrl ?? '');
  const raw = match?.[2] ?? '';
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length === 0) throw new Error('empty photo');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('photo too large (max 5 MB)');

  const abs = join(ROOT, jobId);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);

  const sha256 = createHash('sha256').update(bytes).digest();
  return { sha256, bytes };
}

export async function readCheckinPhoto(jobId) {
  assertJobId(jobId);
  try {
    return await readFile(join(ROOT, jobId));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  return 'application/octet-stream';
}
```

- [ ] **Step 4: Run to green**

Run: `npx vitest run server/checkin-photo.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/checkin-photo.mjs web/server/checkin-photo.test.mjs
git commit -m "feat(jobs): check-in photo disk storage module"
```

---

## Task 2: BFF — check-in takes a photo; vendor + gov photo routes

**Files:**
- Modify: `web/server/bff.mjs`

**Interfaces:**
- Modifies: `POST /api/vendor/jobs/:id/check-in` body `{ lat, lon, accuracyM, photo, deviceId, reportedAt }`.
- Produces: `GET /api/vendor/jobs/:id/checkin-photo`; `GET /api/gov/orders/:id/checkin-photo`.

- [ ] **Step 1: Add the import**

At the top of `web/server/bff.mjs`, after the `kyc-upload.mjs` imports (~line 16):

```js
import { saveCheckinPhoto, readCheckinPhoto, sniffImageType } from './checkin-photo.mjs';
```

- [ ] **Step 2: Rewrite the check-in handler to take a photo**

Replace the body of `POST /api/vendor/jobs/:id/check-in` (currently validates `photoSha256`) with:

```js
  app.post('/api/vendor/jobs/:id/check-in', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { lat, lon, accuracyM, photo, deviceId, reportedAt } = req.body || {};
    if (lat == null || lon == null || !photo || !deviceId) {
      return res.status(400).json({ error: 'missing_checkin_fields' });
    }
    try {
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
```

(Note: `saveCheckinPhoto` validates the job-id shape and the payload; a failed `check_in` — geofence/skew — leaves only a harmless overwritten file.)

- [ ] **Step 3: Add the vendor photo GET (right after the check-in handler)**

```js
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
```

`select 1 from test_jobs` is RLS-scoped (`jobs_read`), so a vendor can only fetch a photo for a job they can see.

- [ ] **Step 4: Add the gov photo GET**

Place it next to the other `/api/gov/orders/:id/...` routes (near the certificate-verify route ~line 1387). It reuses the same `order.read` gate those routes use — copy the exact permission-check block from an adjacent gov order route (e.g. `certificate/verify`) so the pattern matches:

```js
  app.get('/api/gov/orders/:id/checkin-photo', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const jobId = await withUserSession(userId, async (client) => {
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
      if (jobId.denied) return res.status(403).json({ error: 'permission_denied' });
      if (!jobId.jobId) return res.status(404).json({ error: 'no_job' });
      const bytes = await readCheckinPhoto(jobId.jobId);
      if (!bytes) return res.status(404).json({ error: 'no_photo' });
      res.setHeader('content-type', sniffImageType(bytes));
      res.setHeader('cache-control', 'private, max-age=60');
      res.send(bytes);
    } catch (err) {
      res.status(400).json({ error: 'photo_failed', detail: err.message });
    }
  });
```

Before writing, confirm the `has_permission('order.read', ou.path)` expression matches how `certificate/verify` gates (it uses `result.verify`); use `order.read` here — viewing evidence is a read, not a verify.

- [ ] **Step 5: Restart BFF (local DB) + smoke the wiring**

```bash
# kill listener on 8787, then:
EWORKS_USE_LOCAL_PG=1 node server/bff.mjs & sleep 3
curl -s -o /dev/null -w "checkin no-body: %{http_code}\n" -X POST http://127.0.0.1:8787/api/vendor/jobs/x/check-in -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w "vendor photo no-auth: %{http_code}\n" http://127.0.0.1:8787/api/vendor/jobs/x/checkin-photo
curl -s -o /dev/null -w "gov photo no-auth: %{http_code}\n" http://127.0.0.1:8787/api/gov/orders/x/checkin-photo
```
Expected: `401`, `401`, `401` (all guarded).

- [ ] **Step 6: Server tests + lint**

Run: `npx vitest run server/bff.test.mjs server/checkin-photo.test.mjs && npx oxlint server/bff.mjs server/checkin-photo.mjs`
Expected: PASS; no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add web/server/bff.mjs
git commit -m "feat(jobs): check-in accepts a real photo; vendor + gov photo routes"
```

---

## Task 3: Frontend capture lib + api/hooks

**Files:**
- Create: `web/src/lib/photoCapture.ts`
- Delete: `web/src/lib/photoHash.ts`
- Modify: `web/src/features/jobs/api.ts`, `web/src/features/jobs/useJobs.ts`

**Interfaces:**
- Produces: `downscaleToJpegDataUrl(file, maxPx?, quality?) -> Promise<string>`; `checkinPhotoUrl(jobId) -> string`; `checkInToJob` body uses `photo`.

- [ ] **Step 1: Create `web/src/lib/photoCapture.ts`**

```ts
// Downscale a captured/selected image to a small JPEG data URL. Canvas re-encode
// also strips EXIF. Keeps upload payloads well under the 6 MB body limit.
export async function downscaleToJpegDataUrl(
  file: File,
  maxPx = 1600,
  quality = 0.8,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
```

- [ ] **Step 2: Update `web/src/features/jobs/api.ts`**

Change the check-in body and add the photo URL helper:

```ts
export function checkInToJob(
  jobId: string,
  body: {
    lat: number;
    lon: number;
    accuracyM: number;
    photo: string;
    deviceId: string;
    reportedAt?: string;
  },
) {
  return apiClient.post<{ id: string; distanceM: number }>(`/api/vendor/jobs/${jobId}/check-in`, body);
}

export function checkinPhotoUrl(jobId: string) {
  return `/api/vendor/jobs/${jobId}/checkin-photo`;
}
```

- [ ] **Step 3: Delete `web/src/lib/photoHash.ts`**

```bash
git rm web/src/lib/photoHash.ts
```
(There should be no other importers after Task 4; `tsc -b` in Task 4 confirms.)

- [ ] **Step 4: `useJobs.ts`** — no signature change needed (`useCheckIn` already binds `checkInToJob`). Confirm it still compiles after the api change (checked in Task 4).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/photoCapture.ts web/src/features/jobs/api.ts
git commit -m "feat(jobs): photo capture/downscale lib + check-in api takes photo"
```

---

## Task 4: Vendor check-in capture UI + confirmation photo + i18n + test

**Files:**
- Modify: `web/src/features/jobs/JobDetailPage.tsx`
- Create: `web/src/features/jobs/JobDetailPage.test.tsx`
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json`

- [ ] **Step 1: i18n keys (en.json, under `jobs`)**

```json
"takePhoto": "Take / choose site photo",
"retakePhoto": "Retake photo",
"photoRequired": "Attach a site photo to check in",
"checkInPhoto": "Site photo",
```

- [ ] **Step 2: i18n keys (ta.json, under `jobs`)**

```json
"takePhoto": "தள புகைப்படம் எடு / தேர்வு",
"retakePhoto": "மீண்டும் எடு",
"photoRequired": "செக்-இன் செய்ய தள புகைப்படத்தை இணைக்கவும்",
"checkInPhoto": "தள புகைப்படம்",
```

- [ ] **Step 3: Write the failing RTL test `web/src/features/jobs/JobDetailPage.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { JobDetailPage } from './JobDetailPage';
import * as api from './api';
import * as capture from '@/lib/photoCapture';

vi.mock('./api', async (o) => ({
  ...(await o<typeof api>()),
  fetchFieldJob: vi.fn(),
  checkInToJob: vi.fn(async () => ({ id: 'ci', distanceM: 0 })),
}));
vi.mock('@/lib/photoCapture', async (o) => ({
  ...(await o<typeof capture>()),
  downscaleToJpegDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

const job = {
  id: 'job-1', status: 'ASSIGNED', orderId: 'o1', milestone: 'Cube pour',
  requiredBy: '2026-08-20', lat: 11, lng: 76, deviceId: null, vendorName: 'Lab',
  items: [], samples: [], custody: [], checkIn: null, result: null, certificate: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/vendor/jobs/job-1']}>
          <Routes><Route path="/vendor/jobs/:id" element={<JobDetailPage />} /></Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(api.fetchFieldJob).mockResolvedValue(job as never));
afterEach(cleanup);

describe('JobDetailPage — check-in photo', () => {
  it('disables check-in until a photo is attached', async () => {
    renderPage();
    const demo = await screen.findByRole('button', { name: /demo/i });
    expect(demo).toBeDisabled();
  });

  it('sends the photo with the check-in', async () => {
    renderPage();
    await screen.findByText(/Take .* site photo/i);
    const file = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    const demo = await screen.findByRole('button', { name: /demo/i });
    await waitFor(() => expect(demo).toBeEnabled());
    await userEvent.click(demo);
    await waitFor(() => expect(api.checkInToJob).toHaveBeenCalled());
    const body = vi.mocked(api.checkInToJob).mock.calls[0][1];
    expect(body.photo).toBe('data:image/jpeg;base64,AAAA');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/features/jobs/JobDetailPage.test.tsx`
Expected: FAIL — no file input; buttons not photo-gated.

- [ ] **Step 5: Update `web/src/features/jobs/JobDetailPage.tsx`**

Replace the import of `randomPhotoSha256Hex`:
```tsx
import { downscaleToJpegDataUrl } from '@/lib/photoCapture';
import { checkinPhotoUrl } from './api';
```
Add `useRef` to the `react` import: `import { useRef, useState } from 'react';`.

Add photo state inside the component (near the other `useState`s):
```tsx
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await downscaleToJpegDataUrl(file));
    } catch {
      setActionError(t('jobs.checkInFailed'));
    }
  }
```

Change `handleCheckIn` to require and send the photo:
```tsx
  async function handleCheckIn(useDemoGps: boolean) {
    setActionError(null);
    if (!photo) {
      setActionError(t('jobs.photoRequired'));
      return;
    }
    try {
      let lat = DEMO_GPS.lat;
      let lon = DEMO_GPS.lon;
      let accuracyM = DEMO_GPS.accuracyM;
      if (!useDemoGps && navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        accuracyM = pos.coords.accuracy;
      }
      await checkIn.mutateAsync({
        lat, lon, accuracyM, photo,
        deviceId: getDeviceId(),
        reportedAt: new Date().toISOString(),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('jobs.checkInFailed'));
    }
  }
```

In the `canCheckIn` panel (the `<div className="gov-card mt-8 border-l-4 border-l-green p-6">` block), insert the photo capture UI above the GPS buttons and gate the buttons on `photo`:

```tsx
          <div className="mt-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => void onPickPhoto(e)}
            />
            {photo ? (
              <div className="flex items-center gap-3">
                <img src={photo} alt={t('jobs.checkInPhoto')} className="h-20 w-20 rounded-md object-cover" />
                <button type="button" className="gov-btn-secondary text-xs" onClick={() => fileRef.current?.click()}>
                  {t('jobs.retakePhoto')}
                </button>
              </div>
            ) : (
              <button type="button" className="gov-btn-secondary" onClick={() => fileRef.current?.click()}>
                {t('jobs.takePhoto')}
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button" disabled={checkIn.isPending || !photo}
              onClick={() => void handleCheckIn(true)} className="gov-btn-primary"
            >
              {checkIn.isPending ? t('states.loading') : t('jobs.checkInDemo')}
            </button>
            <button
              type="button" disabled={checkIn.isPending || !photo}
              onClick={() => void handleCheckIn(false)} className="gov-btn-secondary"
            >
              {t('jobs.checkInGps')}
            </button>
          </div>
```

In the `job.checkIn` confirmation block, add the stored photo:
```tsx
          <img
            src={checkinPhotoUrl(id)}
            alt={t('jobs.checkInPhoto')}
            className="mt-3 h-32 w-32 rounded-md object-cover"
          />
```

- [ ] **Step 6: Run the RTL test to green**

Run: `npx vitest run src/features/jobs/JobDetailPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc -b && npx oxlint src/features/jobs src/lib/photoCapture.ts`
Expected: clean (confirms `photoHash.ts` had no other importers).

- [ ] **Step 8: Commit**

```bash
git add web/src/features/jobs/JobDetailPage.tsx web/src/features/jobs/JobDetailPage.test.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(jobs): capture + preview + show the site check-in photo"
```

---

## Task 5: Gov fulfillment site-photo view

**Files:**
- Modify: `web/src/features/gov/GovOrderFulfillment.tsx`
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json`

- [ ] **Step 1: i18n keys**

en.json under `fulfillment`: `"sitePhoto": "Site check-in photo"`.
ta.json under `fulfillment`: `"sitePhoto": "தள செக்-இன் புகைப்படம்"`.

- [ ] **Step 2: Add the photo card in `GovOrderFulfillment.tsx`**

After the results `gov-card` block (before the escalations block), insert a card shown when a job exists (`fulfillment.jobId` is already the guard used at the top):

```tsx
      <div className="gov-card p-5">
        <p className="gov-label">{t('fulfillment.sitePhoto')}</p>
        <a href={`/api/gov/orders/${orderId}/checkin-photo`} target="_blank" rel="noreferrer" className="mt-2 inline-block">
          <img
            src={`/api/gov/orders/${orderId}/checkin-photo`}
            alt={t('fulfillment.sitePhoto')}
            className="h-32 w-32 rounded-md object-cover"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
          />
        </a>
      </div>
```

(The `onError` hides the link if no photo exists — e.g. seed jobs that were checked in before this feature. This keeps the card graceful without a separate existence query.)

- [ ] **Step 3: Typecheck + lint + gov tests**

Run: `npx tsc -b && npx oxlint src/features/gov/GovOrderFulfillment.tsx && npx vitest run src/features/gov`
Expected: clean; pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/gov/GovOrderFulfillment.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(jobs): show site check-in photo on gov fulfillment view"
```

---

## Task 6: Full green + live verification

**Files:** none.

- [ ] **Step 1: Full suite, lint, tsc**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: all green.

- [ ] **Step 2: i18n parity**

Run: `node -e "const a=require('./src/i18n/en.json'),b=require('./src/i18n/ta.json');const k=o=>Object.keys(o).flatMap(x=>o[x]&&typeof o[x]==='object'?k(o[x]).map(y=>x+'.'+y):[x]);const ka=new Set(k(a)),kb=new Set(k(b));const miss=[...ka].filter(x=>!kb.has(x)).concat([...kb].filter(x=>!ka.has(x)));console.log(miss.length?('MISMATCH: '+miss.join(', ')):'i18n keys match');"`
Expected: `i18n keys match`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: builds (chunk-size warning is pre-existing).

- [ ] **Step 4: Live check (local DB)**

BFF with `EWORKS_USE_LOCAL_PG=1` + Vite. As a vendor with an `ASSIGNED` job (accept an award to create one), open the job → "Take / choose site photo" → attach an image → GPS buttons enable → **Check in (demo GPS)** → confirmation shows the photo. Then as a gov officer with `order.read` on that order, open the order fulfillment view → the site-visit photo appears.

- [ ] **Step 5: Final commit (if fixups)**

```bash
git add -A && git commit -m "chore(jobs): check-in photo verification"
```

---

## Self-Review

**Spec coverage:**
- Storage module (save/read/sniff, uuid guard, 5 MB cap) → Task 1. ✅
- Check-in takes `photo`, server hashes → Task 2 Step 2. ✅
- Vendor + gov photo GET (RLS / order.read gated) → Task 2 Steps 3–4. ✅
- Client capture + downscale + preview + confirmation photo → Tasks 3, 4. ✅
- Gov fulfillment photo → Task 5. ✅
- i18n en/ta → Tasks 4, 5. ✅
- Unit + RTL tests, no-photo 400 smoke → Tasks 1, 2, 4. ✅
- No migration; local-only DB checks → Global Constraints + Task 6 Step 4. ✅

**Placeholder scan:** No TBD/TODO; every code step is complete. The "confirm the gate matches an adjacent route" notes name the exact neighbor to copy from — deliberate, to keep the permission expression identical to existing gov routes.

**Type consistency:** `checkInToJob` body uses `photo: string` in the api (Task 3), the handler reads `photo` (Task 2), and the UI + test send `photo` (Task 4). `checkinPhotoUrl(jobId)` is defined in api (Task 3) and used in the confirmation block (Task 4). `saveCheckinPhoto` returns `{ sha256, bytes }` consumed as `sha256` in the handler (Task 2) and asserted in the unit test (Task 1). `photoHash.ts` is removed (Task 3) after its only importer (`JobDetailPage`) drops it (Task 4) — `tsc -b` in Task 4 Step 7 verifies no dangling import.
