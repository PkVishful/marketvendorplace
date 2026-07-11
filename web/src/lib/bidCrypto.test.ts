import { describe, it, expect } from 'vitest';
import { computeBidCommitment } from '@/lib/bidCrypto';

describe('bid commitment hash', () => {
  it('matches Postgres eworks.bid_commitment format (32-byte hex)', async () => {
    const hex = await computeBidCommitment(
      '77777777-0000-0000-0000-000000000001',
      '55555555-0000-0000-0000-00000000000a',
      250000,
      'nonce-a',
    );
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('changes when price changes by one paisa', async () => {
    const base = {
      order: '77777777-0000-0000-0000-000000000001',
      vendor: '55555555-0000-0000-0000-00000000000a',
      nonce: 'n',
    };
    const a = await computeBidCommitment(base.order, base.vendor, 250000, base.nonce);
    const b = await computeBidCommitment(base.order, base.vendor, 250001, base.nonce);
    expect(a).not.toBe(b);
  });
});
