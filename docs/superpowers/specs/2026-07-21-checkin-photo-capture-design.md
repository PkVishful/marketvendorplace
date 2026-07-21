# Check-in Photo Capture + Upload — Design

*Status: approved 2026-07-21.*

Today the geo-fenced site check-in **requires** a `photo_sha256` (32 bytes,
globally-unique index — anti-fraud), but the frontend fabricates a random hash
(`randomPhotoSha256Hex()`), so no real photo is ever taken or stored. This adds
real photo capture on check-in: the technician takes/selects a photo, it is
uploaded and stored, and the hash recorded server-side is the hash of that
actual image. Vendor and gov officer can both view it.

## Decisions

- **Photo is mandatory** for check-in (the point of the feature).
- **Storage:** local `dev-uploads/checkins/` on disk, mirroring the existing KYC
  upload pattern (`kyc-upload.mjs`). Production would swap to Supabase Storage.
- **Viewers:** vendor (own job) **and** gov officer (audit evidence on the order
  fulfillment view).
- **No migration** — the file is addressed by job id on disk; the authoritative
  hash already lives in `site_checkins.photo_sha256`.

## Goal / definition of done

- On an `ASSIGNED` job, the technician captures/selects a photo (rear camera on
  mobile), it previews, and check-in uploads it; the stored `photo_sha256` equals
  `sha256(image bytes)`.
- The vendor sees the photo on their job's check-in confirmation; a gov officer
  with `order.read` on the order sees it on the order fulfillment view.
- `npm run test`, `npm run lint`, `tsc -b` green; the flow works in the app.
- No shared-remote schema change.

## Relevant existing mechanics

- `eworks.check_in(job_id, lat, lon, accuracy_m, device_id, photo_sha256, reported_at)`
  computes distance/skew, enforces the geofence, inserts `site_checkins`
  (`photo_sha256 bytea not null`, `unique (job_id)`, unique `photo_sha256`).
- `POST /api/vendor/jobs/:id/check-in` currently takes a client `photoSha256`
  (32-byte hex) plus GPS. `express.json({ limit: '6mb' })` is configured.
- `kyc-upload.mjs`: `saveKycDocument(...)` decodes a `data:` URL, caps at 5 MB,
  writes to `dev-uploads/kyc/...`, returns `{ storagePath, sha256, bytes }`;
  `readKycDocument(path)` reads it; a GET route streams the bytes.
- Vendor `GET /api/vendor/jobs/:id` already returns `checkIn { distanceM,
  accuracyM, serverAt }`. Gov `GET /api/gov/orders/:id` returns a `fulfillment`
  object rendered by `GovOrderFulfillment.tsx`.
- `client` device id via `getDeviceId()`; the check-in panel lives in
  `JobDetailPage.tsx` (shown while `status === 'ASSIGNED'`).

## Layer 1 — Storage (`web/server/checkin-photo.mjs`, new)

Mirror the KYC module:

- `saveCheckinPhoto(jobId, base64DataUrl)` → decode `data:<mime>;base64,...`,
  reject empty / > 5 MB, write bytes to `dev-uploads/checkins/<jobId>` (no ext),
  return `{ sha256: Buffer, bytes }`. `sha256` is the authoritative hash.
- `readCheckinPhoto(jobId)` → read `dev-uploads/checkins/<jobId>`; return the
  Buffer (or null if absent).
- `sniffImageType(bytes)` → `image/jpeg` for `FF D8 FF`, `image/png` for
  `89 50 4E 47`, else `application/octet-stream` — used when serving.

The path is validated against a `<jobId>` UUID shape to prevent traversal.

## Layer 2 — BFF (`web/server/bff.mjs`)

- **Modify** `POST /api/vendor/jobs/:id/check-in`: accept `photo` (base64 data
  URL) instead of `photoSha256`. Steps: `saveCheckinPhoto(jobId, photo)` →
  `{ sha256 }` → `check_in($1..$6, sha256, ...)`. Reject with 400 if `photo`
  is missing or not a valid image. (Drop the `photoSha256` path — real photos
  only.) If `check_in` throws (geofence/skew), the just-saved file is harmless
  (overwritten next attempt); no partial DB state (check_in is atomic).
- **Add** `GET /api/vendor/jobs/:id/checkin-photo`: inside `withUserSession`,
  confirm the caller can read the job (existing `jobs_read` RLS via a
  `select 1 from test_jobs where id = $1`); then `readCheckinPhoto(jobId)` and
  stream with the sniffed content-type. 404 if none.
- **Add** `GET /api/gov/orders/:id/checkin-photo`: require `order.read` on the
  order's path (same gate pattern as other gov order routes); resolve the order's
  job id (`select id from test_jobs where order_id = $1`); `readCheckinPhoto` and
  stream. 403 without permission, 404 if no job/photo.

## Layer 3 — Frontend

**`web/src/lib/photoCapture.ts` (new)** — `downscaleToJpegDataUrl(file, maxPx=1600, quality=0.8): Promise<string>`: draw the image to a canvas capped at `maxPx` on the long edge, export `image/jpeg` data URL. Keeps payloads ~200–500 KB, well under the 6 MB body limit. (`randomPhotoSha256Hex` / `photoHash.ts` is removed once unused.)

**`jobs/api.ts` + `useJobs.ts`** — `checkInToJob` body changes: `{ lat, lon, accuracyM, photo, deviceId, reportedAt }` (was `photoSha256`). Add `checkinPhotoUrl(jobId)` → the GET URL string for `<img>`.

**`jobs/JobDetailPage.tsx`** — the check-in panel gains:
- a hidden `<input type="file" accept="image/*" capture="environment">` behind a
  "Take / choose photo" button; on change → `downscaleToJpegDataUrl` → store the
  data URL in state + show a thumbnail preview;
- the two GPS buttons (`demo` / `device`) are **disabled until a photo is
  attached**; `handleCheckIn` sends `photo` instead of a random hash;
- after check-in, the confirmation block shows the stored photo via
  `<img src={checkinPhotoUrl(id)}>`.

**`gov/GovOrderFulfillment.tsx`** — when the order has a checked-in job, show the
check-in photo (thumbnail linking to full size) via
`/api/gov/orders/:id/checkin-photo`, labelled as site-visit evidence, alongside
the existing distance/accuracy fulfillment data.

**i18n** (en + ta, identical keys): `jobs.takePhoto`, `jobs.retakePhoto`,
`jobs.photoRequired`, `jobs.checkInPhoto`, `jobs.sitePhoto`; `fulfillment.sitePhoto`.

## Layer 4 — Tests

- `web/server/checkin-photo.test.mjs` (unit, no DB): `saveCheckinPhoto` decodes a
  1x1 PNG data URL, returns a 32-byte sha256 = `sha256(bytes)`; rejects empty and
  oversize; `sniffImageType` classifies PNG/JPEG magic bytes.
- Extend the vendor DB-gated ground-execution flow (or `bff.test.mjs`): check-in
  without `photo` → 400.
- RTL (`JobDetailPage` check-in): GPS buttons are disabled until a photo is
  attached; after attaching (mock `downscaleToJpegDataUrl`), clicking a GPS
  button calls `checkInToJob` with a `photo` field.

## Out of scope

- Re-encoding/EXIF stripping beyond the canvas re-encode (canvas export already
  drops EXIF).
- Multiple photos per check-in (the model is one photo per job).
- Production Supabase Storage wiring.
- Changes to the shared remote schema.
