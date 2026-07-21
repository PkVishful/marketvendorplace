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
