// Pure finance helpers — no DB, no I/O — so they unit-test without Postgres.

const CLOSED = new Set(['REVEALING', 'AWARDED', 'FAILED', 'CANCELLED']);

// Bidding is closed (bid amounts may be revealed) once the order leaves FLOATED.
export function isBiddingClosed(status) {
  return CLOSED.has(status);
}

// Savings = Σ(estimate) − Σ(award), counting only orders that have BOTH. A
// missing estimate is excluded from the sums entirely — never coerced to 0.
export function computeSavings(rows) {
  let estimatedPaise = 0;
  let awardedPaise = 0;
  for (const r of rows) {
    if (r.estimatePaise != null && r.awardPaise != null) {
      estimatedPaise += Number(r.estimatePaise);
      awardedPaise += Number(r.awardPaise);
    }
  }
  return { estimatedPaise, awardedPaise, savingsPaise: estimatedPaise - awardedPaise };
}

// Minimal RFC-4180 CSV. Fields with comma/quote/newline are quoted; embedded
// quotes are doubled. Rows are CRLF-terminated including the last.
export function toCsv(headers, rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) lines.push(row.map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}
