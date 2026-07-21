# Real Certificate Upload — Design

*Status: approved 2026-07-21.*

Today the lab "uploads" a certificate by posting a fabricated hash and a fake
`certs/<id>.pdf` path (`handleUploadCertificate` → `randomPhotoSha256Hex()`); no
file exists. This makes the vendor upload real: the lab uploads an actual PDF,
it is stored, and the recorded `sha256` is the hash of those bytes — so the
public verify page's hash becomes a genuine integrity proof. The PDF is
downloadable by the vendor, in-scope gov officers, and the public verify page.

## Decisions

- **Public download:** the actual PDF is downloadable from the public verify page
  (anyone with the certificate id / QR). The id is an unguessable UUID.
- **PDF only**, validated by the `%PDF` magic bytes; 5 MB cap (KYC parity; under
  the 6 MB `express.json` limit).
- **Storage:** local `dev-uploads/certificates/` on disk (production → Supabase
  Storage), mirroring `kyc-upload.mjs` / `checkin-photo.mjs`.
- **No migration** — `certificates.storage_path` and `certificates.sha256`
  already exist; this works against the remote too.

## Goal / definition of done

- The lab picks a PDF on the job's certificate step; it uploads; the stored
  `certificates.sha256` equals `sha256(pdf bytes)` and `storage_path` points to
  the real file.
- The vendor, an in-scope gov officer, and the public verify page can each open
  the actual PDF.
- `npm run test`, `npm run lint`, `tsc -b` green; flow works in the app.
- No shared-remote schema change.

## Relevant existing mechanics

- `certificates (job_id, storage_path text, sha256 bytea unique (32), signature_verified,
  signer_name, verified_at, uploaded_by, unique (job_id))`. Signature verification
  is a separate gov step and is unchanged.
- `POST /api/vendor/jobs/:id/certificate` currently takes `{ storagePath, sha256 }`
  and inserts. `express.json({ limit: '6mb' })`.
- `GET /api/public/certificates/:id` returns metadata incl. `sha256Hex`,
  `signatureVerified`, project/lab names — no file today.
- Gov `GovOrderFulfillment.tsx` renders a certificate card (`fulfillment.certificate`,
  showing `storagePath` + verified state). Public verify UI lives in
  `src/features/public/`.
- Established upload pattern: decode `data:` URL, cap size, write to disk, return
  `{ sha256, storagePath }`; a GET route streams the bytes with a content-type.

## Layer 1 — Storage (`web/server/certificate-file.mjs`, new)

- `saveCertificate(jobId, base64DataUrl)` → decode; require non-empty, ≤ 5 MB,
  and first bytes `25 50 44 46` (`%PDF`) else throw `not a PDF`; write to
  `dev-uploads/certificates/<jobId>.pdf`; return `{ sha256: Buffer, storagePath:
  'dev/certificates/<jobId>.pdf' }`.
- `readCertificate(jobId)` → read `dev-uploads/certificates/<jobId>.pdf`; return
  Buffer or null. Job-id validated against a UUID shape (traversal guard).

## Layer 2 — BFF (`web/server/bff.mjs`)

- **Modify** `POST /api/vendor/jobs/:id/certificate`: accept `file` (base64 PDF
  data URL) instead of `{ storagePath, sha256 }`. Steps: `saveCertificate(jobId,
  file)` → `{ sha256, storagePath }` → insert with the real `storage_path` +
  `sha256`. 400 on missing/invalid file.
- **Add** `GET /api/vendor/jobs/:id/certificate/file`: RLS-scoped (`select 1 from
  test_jobs where id = $1`); stream `readCertificate(jobId)` as `application/pdf`
  with `content-disposition: inline; filename="certificate.pdf"`. 404 if none.
- **Add** `GET /api/gov/orders/:id/certificate/file`: `order.read` gate (mirror
  the gov checkin-photo route); resolve the order's job; stream the PDF.
- **Add** `GET /api/public/certificates/:id/file`: no auth; look up the
  certificate's `job_id` (via `pool`, like the existing public metadata route);
  stream the PDF. 404 if the certificate or file is absent.

All PDF responses set `application/pdf` and `content-disposition: inline`.

## Layer 3 — Frontend

**`jobs/api.ts` + `useJobs.ts`** — `uploadJobCertificate(jobId, { file })` (was
`{ storagePath, sha256 }`); add `certificateFileUrl(jobId)`.

**`jobs/JobDetailPage.tsx`** — replace the dev button + `handleUploadCertificate`
(which used `randomPhotoSha256Hex`) with a PDF file input (`accept="application/pdf"`)
that reads the file as a base64 data URL and uploads it. After upload
(`job.certificate` present), show a "View certificate" link to
`certificateFileUrl(id)`. (`randomPhotoSha256Hex` / `photoHash.ts` is then unused
and removed.)

**`gov/GovOrderFulfillment.tsx`** — in the certificate card, add a "Download PDF"
link to `/api/gov/orders/:id/certificate/file` when `fulfillment.certificate` is
set.

**Public verify (`src/features/public/…`)** — when a certificate is found, add a
"Download certificate PDF" link to `/api/public/certificates/:id/file`.

**i18n** (en + ta, identical keys): `results.pickCert`, `results.viewCert`,
`fulfillment.downloadCert`, `verify.downloadCert`.

## Layer 4 — Tests

- `web/server/certificate-file.test.mjs` (unit, no DB): `saveCertificate` accepts
  a minimal `%PDF-1.4` payload and returns a 32-byte sha256 = `sha256(bytes)` and
  the expected `storagePath`; rejects empty, oversize, and non-PDF (e.g. a PNG
  data URL → `not a PDF`).
- `bff.test.mjs`: the vendor certificate POST rejects a missing `file` (400).
- RTL (`JobDetailPage`): with all results entered and no certificate, a PDF file
  input is present; uploading a file calls `uploadJobCertificate` with a `file`
  data URL.

## Out of scope

- Signature verification changes (still a separate gov step; a real DSC needs a
  licensed CA per docs/security-gaps.md #7).
- Multi-file or non-PDF certificates.
- Production Supabase Storage wiring.
- Shared remote schema changes.
