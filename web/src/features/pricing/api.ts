import { apiClient } from '@/lib/apiClient';
import type { GovVendorRateRow, PriceSetResult, PriceWindow, VendorRateRow } from '@/types/domain';

export const pricingKeys = {
  all: ['vendor', 'pricing'] as const,
  history: (testId: string) => ['vendor', 'pricing', testId, 'history'] as const,
  gov: (vendorId: string) => ['gov', 'vendors', vendorId, 'pricing'] as const,
};

export function fetchVendorPricing() {
  return apiClient.get<VendorRateRow[]>('/api/vendor/pricing');
}

export function setPrice(testId: string, body: { pricePaise: number; effectiveFrom?: string }) {
  return apiClient.put<PriceSetResult>(`/api/vendor/pricing/${testId}`, body);
}

export function fetchPriceHistory(testId: string) {
  return apiClient.get<PriceWindow[]>(`/api/vendor/pricing/${testId}/history`);
}

export function stopOffering(testId: string) {
  return apiClient.delete<{ stopped: boolean }>(`/api/vendor/pricing/${testId}`);
}

export function fetchGovVendorPricing(vendorId: string) {
  return apiClient.get<GovVendorRateRow[]>(`/api/gov/vendors/${vendorId}/pricing`);
}

// --- money: integer paise end-to-end, no float drift ----------------------

/** "1250.50" → 125050. Null when not a valid rupee amount or below a paisa. */
export function rupeesToPaiseExact(input: string): number | null {
  const cleaned = input.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise;
}

/** 125050 → "₹1,250.50" — always two decimals, en-IN grouping. */
export function formatPaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/** Local calendar date (YYYY-MM-DD) for the date input's min attribute. */
export function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The day before an ISO date — "your current price runs until <this>". */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
