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
