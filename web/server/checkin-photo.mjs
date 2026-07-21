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
