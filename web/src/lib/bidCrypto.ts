// Client-side sealed bid commitment — must match eworks.bid_commitment() in Postgres.
// sha256(order_id : vendor_id : price_paise : nonce)

export async function computeBidCommitment(
  orderId: string,
  vendorId: string,
  pricePaise: number,
  nonce: string,
): Promise<string> {
  const payload = `${orderId}:${vendorId}:${pricePaise}:${nonce}`;
  const data = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function storeBidSecrets(orderId: string, pricePaise: number, nonce: string) {
  sessionStorage.setItem(`bid:${orderId}`, JSON.stringify({ pricePaise, nonce }));
}

export function loadBidSecrets(orderId: string): { pricePaise: number; nonce: string } | null {
  const raw = sessionStorage.getItem(`bid:${orderId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { pricePaise: number; nonce: string };
  } catch {
    return null;
  }
}

export function clearBidSecrets(orderId: string) {
  sessionStorage.removeItem(`bid:${orderId}`);
}
