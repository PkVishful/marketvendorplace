// Domain types mirroring the Phase 6a backend. Kept hand-written for now; when
// the BFF/PostgREST types are generated (`supabase gen types typescript`), the
// generated row types slot in behind these view models.

export type Portal = 'vendor' | 'gov' | 'unknown';

export interface UserRole {
  code: string;
  orgName: string;
}

export interface Session {
  authenticated: boolean;
  userId?: string;
  phone?: string;
  fullName?: string;
  portal?: Portal;
  roles?: UserRole[];
  vendorId?: string | null;
  vendorName?: string | null;
}

export function portalHomePath(portal: Portal | undefined): string {
  if (portal === 'vendor') return '/vendor';
  if (portal === 'gov') return '/gov';
  return '/sign-in';
}

export function portalHomePathForSession(session: Session): string {
  const isFieldTech = session.roles?.some((r) => r.code === 'FIELD_TECHNICIAN');
  if (isFieldTech) return '/vendor/jobs';
  return portalHomePath(resolvePortal(session));
}

export function resolvePortal(session: Session): Portal | undefined {
  if (session.portal === 'vendor' || session.portal === 'gov') return session.portal;
  return undefined;
}

export const EVENT_TYPES = [
  'VENDOR_APPROVED',
  'VENDOR_REJECTED',
  'ORDER_FLOATED',
  'REVEAL_WINDOW_OPEN',
  'AWARD_WON',
  'AWARD_LOST',
  'ORDER_FAILED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface OrderItemDTO {
  id: string;
  quantity: number;
  testAgesDays: number[];
  testCode: string;
  testName: string;
  requiresNabl: boolean;
  isCode: string | null;
}

export interface VendorOrderSummary {
  id: string;
  milestone: string;
  status: string;
  requiredBy: string;
  floatedAt: string | null;
  bidCloseAt: string | null;
  revealCloseAt: string | null;
  lat: number;
  lng: number;
  itemCount: number;
}

export interface VendorBidDTO {
  id: string;
  status: string;
  committedAt: string;
  revealedPricePaise: number | null;
  revealedAt: string | null;
}

export interface VendorOrderDetail extends Omit<VendorOrderSummary, 'itemCount'> {
  evalMethod: string;
  orgName: string;
  items: OrderItemDTO[];
  myBid: VendorBidDTO | null;
}

// One row of the vendor feed.
export interface NotificationDTO {
  id: string;
  createdAt: string;
  readAt: string | null;
  eventType: EventType;
  orderId: string | null;
  vendorId: string | null;
  orderAlive: boolean;
  orderMilestone: string | null;
  orderStatus: string | null;
}

// A notification is a dead link when it points at an order the vendor may no
// longer see (eligibility lapsed, or the order was closed) — never a crash,
// never a leak.
export function isDeadLink(n: NotificationDTO): boolean {
  return n.orderId !== null && !n.orderAlive;
}

// A live order the vendor can open.
export function hasLiveOrder(n: NotificationDTO): boolean {
  return n.orderId !== null && n.orderAlive;
}

export interface GovProject {
  id: string;
  code: string;
  name: string;
}

export interface ConstructionStage {
  id: string;
  code: string;
  name: string;
  sequence: number;
}

export interface ProjectRequirement {
  id: string;
  plannedCount: number;
  status: string;
  requiredBy: string | null;
  testCode: string;
  testName: string;
  stageCode: string;
  stageName: string;
}

export interface GovOrderSummary {
  id: string;
  projectId: string;
  milestone: string;
  status: string;
  requiredBy: string;
  floatedAt: string | null;
  bidCloseAt: string | null;
  revealCloseAt?: string | null;
  stageCode: string;
  orgName: string;
  itemCount: number;
}

export interface GovBidRow {
  id: string;
  status: string;
  committedAt: string;
  revealedPricePaise: number | null;
  revealedAt: string | null;
  vendorName: string;
}

export interface OrderAwardDTO {
  vendorId: string;
  vendorName: string;
  pricePaise: number;
  qualifiedBidCount: number;
  awardedAt: string;
}

export interface GovOrderDetail extends GovOrderSummary {
  evalMethod: string;
  items: OrderItemDTO[];
  bids: GovBidRow[];
  award: OrderAwardDTO | null;
  canAward: boolean;
  fulfillment: GovFulfillmentDTO | null;
}

export interface GovVendorSummary {
  id: string;
  legalName: string;
  status: string;
  gstin: string;
  nablNo: string | null;
  nablValidUntil: string | null;
  districtName: string;
  createdAt: string;
}

export interface GovVendorDocument {
  id: string;
  docType: string;
  status: string;
  mimeType: string;
  storagePath: string;
  rejectReason?: string | null;
}

export interface GovVendorCapability {
  testCode: string;
  testName: string;
  isNablAccredited: boolean;
}

export interface GovVendorDetail extends GovVendorSummary {
  address: string;
  serviceRadiusKm: number;
  documents: GovVendorDocument[];
  capabilities: GovVendorCapability[];
}

export type CustodyEvent =
  | 'MOLDED'
  | 'SEALED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'RECEIVED_AT_LAB'
  | 'TESTED';

export interface FieldJobSummary {
  id: string;
  status: string;
  orderId: string;
  milestone: string;
  requiredBy: string;
  lat: number;
  lng: number;
  sampleCount: number;
}

export interface FieldJobDetail extends Omit<FieldJobSummary, 'sampleCount'> {
  deviceId: string | null;
  vendorName: string;
  items: { quantity: number; testCode: string; testName: string; testAgesDays: number[] }[];
  samples: {
    id: string;
    qrCode: string;
    specimenNo: number;
    testAgeDays: number | null;
    testName: string;
    receivedAtLab: boolean;
    result: SampleResultDTO | null;
  }[];
  checkIn: { distanceM: number; accuracyM: number; serverAt: string } | null;
  custody: { event: CustodyEvent; occurredAt: string; qrCode: string }[];
  certificate: CertificateDTO | null;
  payment: PaymentDTO | null;
}

export interface SampleResultDTO {
  id: string;
  metric: string;
  metricValue: number;
  thresholdMin: number | null;
  thresholdMax: number | null;
  passed: boolean;
  isProvisional: boolean;
  enteredAt: string;
}

export interface CertificateDTO {
  id: string;
  storagePath: string;
  signatureVerified: boolean;
  signerName: string | null;
  verifiedAt: string | null;
  issuedAt: string;
}

export interface PaymentDTO {
  id: string;
  status: 'HELD' | 'RELEASED' | 'CANCELLED';
  amountPaise: number;
  treasuryRef: string | null;
  gstInvoiceNo: string | null;
  releasedAt: string | null;
}

export interface EscalationDTO {
  id: string;
  level: string;
  status: string;
  reason: string;
  raisedAt: string;
  qrCode: string;
  metric: string;
  metricValue: number;
}

export interface GovFulfillmentDTO {
  jobId: string | null;
  results: {
    qrCode: string;
    testName: string;
    specimenNo: number;
    testAgeDays: number | null;
    metric: string;
    metricValue: number;
    passed: boolean;
    isProvisional: boolean;
  }[];
  escalations: EscalationDTO[];
  certificate: CertificateDTO | null;
  payment: PaymentDTO | null;
  canVerifyCertificate: boolean;
  canReleasePayment: boolean;
  resultsComplete: boolean;
}

export type MilestoneHealth = 'green' | 'amber' | 'red' | 'neutral';

export interface QualityMilestoneRow {
  id: string;
  milestone: string;
  status: string;
  requiredBy: string;
  stageCode: string;
  orgName: string;
  vendorName: string | null;
  openEscalations: number;
  paymentStatus: string | null;
  certVerified: boolean;
  sampleCount: number;
  resultCount: number;
  health: MilestoneHealth;
}

export interface QualityDashboardDTO {
  counts: Record<MilestoneHealth, number>;
  milestones: QualityMilestoneRow[];
}

export type VendorRatingTier = 'excellent' | 'good' | 'watch' | 'new' | 'neutral';

export interface VendorRatingRow {
  id: string;
  legalName: string;
  status: string;
  districtName: string;
  awardsWon: number;
  jobsCompleted: number;
  openEscalations: number;
  resultCount: number;
  passRate: number;
  tier: VendorRatingTier;
}

export interface VendorEarningsSummary {
  heldPaise: number;
  releasedPaise: number;
  heldCount: number;
  releasedCount: number;
}

export interface VendorPaymentRow {
  id: string;
  orderId: string;
  milestone: string;
  status: 'HELD' | 'RELEASED' | 'CANCELLED';
  amountPaise: number;
  treasuryRef: string | null;
  gstInvoiceNo: string | null;
  releasedAt: string | null;
  createdAt: string;
}

export interface VendorEarningsDTO {
  summary: VendorEarningsSummary;
  payments: VendorPaymentRow[];
}

export interface AuditLogRow {
  seq: number;
  action: string;
  entityType: string;
  entityId: string | null;
  orgPath: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  actorName: string | null;
}

export interface AuditChainStatus {
  allowed: boolean;
  intact?: boolean;
  brokenAtSeq?: number | null;
  headSeq?: number | null;
  headHash?: string | null;
}

export interface PublicCertificateDTO {
  found: boolean;
  id?: string;
  sha256Hex?: string;
  signatureVerified?: boolean;
  signerName?: string | null;
  verifiedAt?: string | null;
  issuedAt?: string;
  milestone?: string;
  projectName?: string;
  projectCode?: string;
  labName?: string;
  orgName?: string;
}

export interface ProcurementAnalyticsDTO {
  ordersByStatus: { status: string; count: number }[];
  totals: {
    floated: number;
    awarded: number;
    bidsSubmitted: number;
    bidsRevealed: number;
    paymentsHeldPaise: number;
    paymentsReleasedPaise: number;
    openEscalations: number;
    certificatesVerified: number;
  };
  recentAwards: {
    orderId: string;
    milestone: string;
    vendorName: string;
    pricePaise: number;
    awardedAt: string;
  }[];
}
