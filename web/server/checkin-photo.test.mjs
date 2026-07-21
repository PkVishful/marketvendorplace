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
