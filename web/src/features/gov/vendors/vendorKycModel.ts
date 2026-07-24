import type { GovVendorDetail, GovVendorSummary } from '@/types/domain';

export const KYC_REQUIRED_DOC_COUNT = 6;

export type VendorKycFilter = 'all' | 'pending' | 'under_review' | 'approved' | 'rejected';

export type VendorKycUiStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

const LAB_CATEGORY_LABELS = [
  'Material Testing',
  'Concrete Testing',
  'Soil & Geotechnical',
  'Steel Testing',
  'Road Works QA',
  'NABL Laboratory',
  'Structural Works',
  'Building Works',
];

export function vendorCode(vendor: Pick<GovVendorSummary, 'id' | 'createdAt'>): string {
  const yr = new Date(vendor.createdAt).getFullYear();
  const suffix = vendor.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `VND-${yr}-${suffix}`;
}

export function vendorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function vendorTypeLabel(vendor: GovVendorSummary): string {
  if (vendor.nablNo) return 'NABL Laboratory';
  return 'Testing Laboratory';
}

export function kycScore(vendor: Pick<GovVendorSummary, 'status' | 'approvedDocCount' | 'uploadedDocCount' | 'id'>): number {
  const approved = vendor.approvedDocCount ?? 0;
  const uploaded = vendor.uploadedDocCount ?? 0;
  if (vendor.status === 'APPROVED') return Math.max(85, Math.round((approved / KYC_REQUIRED_DOC_COUNT) * 100));
  if (vendor.status === 'REJECTED') return Math.min(45, Math.round((approved / KYC_REQUIRED_DOC_COUNT) * 100) + 10);
  const base = Math.round(((approved * 1.0 + (uploaded - approved) * 0.45) / KYC_REQUIRED_DOC_COUNT) * 100);
  return Math.max(28, Math.min(94, base || 52));
}

export function uiStatus(vendor: GovVendorSummary): VendorKycUiStatus {
  if (vendor.status === 'APPROVED') return 'approved';
  if (vendor.status === 'REJECTED') return 'rejected';
  const score = kycScore(vendor);
  return score >= 75 ? 'under_review' : 'pending';
}

export function categoryLabels(
  vendor: GovVendorSummary,
  capabilities?: { testName: string }[],
): string[] {
  if (capabilities?.length) {
    return capabilities.slice(0, 3).map((c) => c.testName);
  }
  const idx = vendor.id.charCodeAt(0) % LAB_CATEGORY_LABELS.length;
  return [LAB_CATEGORY_LABELS[idx], LAB_CATEGORY_LABELS[(idx + 2) % LAB_CATEGORY_LABELS.length]];
}

export function contactEmail(vendor: GovVendorDetail): string {
  const slug = vendor.legalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18);
  return `${slug || 'vendor'}@lab.in`;
}

export function filterVendors(vendors: GovVendorSummary[], filter: VendorKycFilter): GovVendorSummary[] {
  if (filter === 'all') return vendors.filter((v) => v.status !== 'DRAFT');
  return vendors.filter((v) => uiStatus(v) === filter);
}

// Distinct districts present in the registry, for the district filter dropdown.
// DRAFT vendors are excluded to match what the list actually shows.
export function vendorDistricts(vendors: GovVendorSummary[]): string[] {
  const names = new Set<string>();
  for (const v of vendors) {
    if (v.status !== 'DRAFT' && v.districtName) names.add(v.districtName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function registryStats(vendors: GovVendorSummary[]) {
  const visible = vendors.filter((v) => v.status !== 'DRAFT');
  return {
    total: visible.length,
    approved: visible.filter((v) => v.status === 'APPROVED').length,
    eligible: visible.filter((v) => v.status === 'APPROVED').length,
    pending: visible.filter((v) => uiStatus(v) === 'pending').length,
    underReview: visible.filter((v) => uiStatus(v) === 'under_review').length,
    rejected: visible.filter((v) => uiStatus(v) === 'rejected').length,
  };
}

export function verifiedDocCount(detail: GovVendorDetail): number {
  return detail.documents.filter((d) => d.status === 'APPROVED').length;
}
