const CROCKFORD = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateQrCode(): string {
  let body = '';
  for (let i = 0; i < 12; i++) {
    body += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  }
  return `EW-${body}`;
}

export function isValidQrCode(code: string): boolean {
  return /^EW-[2-9A-HJ-NP-Z]{12}$/.test(code);
}
