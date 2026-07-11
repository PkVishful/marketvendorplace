// Dev-only KYC document storage on local disk (production → Supabase Storage).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dev-uploads', 'kyc');

export async function saveKycDocument(vendorId, docType, base64Data, mimeType) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(base64Data);
  const mime = match?.[1] ?? mimeType ?? 'application/octet-stream';
  const raw = match?.[2] ?? base64Data;
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length === 0) throw new Error('empty file');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('file too large (max 5 MB)');

  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'bin';
  const rel = `${vendorId}/${docType}.${ext}`;
  const abs = join(ROOT, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);

  const sha256 = createHash('sha256').update(bytes).digest();
  return { storagePath: `dev/kyc/${rel}`, mimeType: mime, sha256, bytes };
}

export async function readKycDocument(storagePath) {
  if (!storagePath.startsWith('dev/kyc/')) throw new Error('invalid path');
  const rel = storagePath.slice('dev/kyc/'.length);
  const abs = join(ROOT, rel);
  return readFile(abs);
}
