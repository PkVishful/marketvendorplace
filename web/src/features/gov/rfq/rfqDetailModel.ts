import type { GovBidRow, GovOrderDetail, GovOrderSummary, OrderItemDTO } from '@/types/domain';

export type DocSigStatus = 'signed' | 'pending';
export type LabTestStatus = 'completed' | 'lab_assigned' | 'pending';
export type LabPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface RfqDocumentRow {
  id: string;
  name: string;
  version: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  signature: DocSigStatus;
  status: 'verified' | 'pending';
}

export interface RfqLabTestRow {
  id: string;
  testName: string;
  priority: LabPriority;
  requiredQty: string;
  assignedLab: string;
  deadline: string;
  engineer: string;
  status: LabTestStatus;
}

export interface RfqParticipationStats {
  invited: number;
  accepted: number;
  submitted: number;
  invPending: number;
  invDeclined: number;
  responsePct: number;
}

export interface RfqTimelineStep {
  id: string;
  label: string;
  date: string;
  actor: string;
  role: string;
  active: boolean;
  done: boolean;
}

export interface RfqActivityItem {
  id: string;
  type: 'system' | 'document' | 'reminder' | 'invitation' | 'lab' | 'comment';
  title: string;
  subtitle: string;
  when: string;
}

export interface RfqDetailViewModel {
  rfqCode: string;
  title: string;
  statusLabel: string;
  daysToClose: number | null;
  closeHint: string;
  estimatedBudgetCr: string;
  budgetDelta: string;
  invitedVendors: number;
  vendorResponsePct: number;
  labTestsCount: number;
  labTestsDone: number;
  description: string;
  meta: {
    concreteGrade: string;
    quantity: string;
    projectLength: string;
    location: string;
    duration: string;
    safetyClass: string;
    workType: string;
    priority: string;
  };
  scopeText: string;
  documents: RfqDocumentRow[];
  labTests: RfqLabTestRow[];
  participation: RfqParticipationStats;
  timeline: RfqTimelineStep[];
  activity: RfqActivityItem[];
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function shortOrgCode(orgName: string): string {
  if (/coimbatore/i.test(orgName)) return 'CBE';
  if (/salem/i.test(orgName)) return 'SLM';
  return orgName.slice(0, 3).toUpperCase();
}

export function rfqCodeFromSummary(
  order: Pick<GovOrderSummary, 'id' | 'orgName' | 'floatedAt' | 'requiredBy'>,
): string {
  const yr = order.floatedAt
    ? new Date(order.floatedAt).getFullYear()
    : new Date(order.requiredBy).getFullYear();
  const suffix = order.id.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `RFQ-${shortOrgCode(order.orgName)}-${yr}-${suffix}`;
}

function rfqCode(order: GovOrderDetail): string {
  return rfqCodeFromSummary(order);
}

function priorityForTest(code: string, index: number): LabPriority {
  if (/CUBE|STRENGTH|COMPRESSIVE/i.test(code)) return 'CRITICAL';
  if (/STEEL|TENSILE/i.test(code)) return 'HIGH';
  if (/SOIL|DENSITY/i.test(code)) return 'MEDIUM';
  return index === 0 ? 'CRITICAL' : index === 1 ? 'HIGH' : 'LOW';
}

function labTestRows(items: OrderItemDTO[], requiredBy: string): RfqLabTestRow[] {
  const deadline = requiredBy.slice(0, 10);
  return items.map((item, i) => ({
    id: item.id,
    testName: item.testName,
    priority: priorityForTest(item.testCode, i),
    requiredQty:
      item.quantity > 1
        ? `${item.quantity} specimens`
        : item.testAgesDays?.length
          ? `${item.testAgesDays.length} ages`
          : '1 sample',
    assignedLab: item.requiresNabl ? 'NABL Lab, CBE' : 'On-site Unit',
    deadline,
    engineer: i % 2 === 0 ? 'Er. Rajesh Kumar' : 'Er. Suresh Babu',
    status: i === 0 ? 'completed' : i === 1 ? 'lab_assigned' : 'pending',
  }));
}

function participationFromBids(bids: GovBidRow[]): RfqParticipationStats {
  const submitted = bids.filter((b) => ['COMMITTED', 'REVEALED'].includes(b.status)).length;
  const invited = Math.max(12, submitted + 5);
  const accepted = Math.max(submitted, Math.round(invited * 0.58));
  const invPending = Math.max(0, invited - accepted - 2);
  const invDeclined = Math.max(0, invited - accepted - submitted);
  return {
    invited,
    accepted,
    submitted,
    invPending,
    invDeclined,
    responsePct: invited > 0 ? Math.round((accepted / invited) * 100) : 0,
  };
}

function estimateBudgetCr(items: OrderItemDTO[]): { budget: string; delta: string } {
  const paise = items.reduce((sum, i) => sum + i.quantity * 250_000_00, 0);
  const cr = paise / 100 / 10_000_000;
  return {
    budget: cr >= 1 ? `₹${cr.toFixed(1)} Cr` : `₹${(paise / 100).toLocaleString('en-IN')}`,
    delta: '+0% vs. estimate',
  };
}

function staticDocuments(floatedAt: string | null): RfqDocumentRow[] {
  const base = floatedAt ? new Date(floatedAt) : new Date();
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return [
    {
      id: 'boq',
      name: 'Bill of Quantities (BOQ)',
      version: 'v2.1',
      size: '2.4 MB',
      uploadedBy: 'Er. Priya Sundar',
      uploadedAt: fmt(base),
      signature: 'signed',
      status: 'verified',
    },
    {
      id: 'drawings',
      name: 'Technical Drawing Package',
      version: 'v1.4',
      size: '18.7 MB',
      uploadedBy: 'Er. Rajesh Kumar',
      uploadedAt: fmt(new Date(base.getTime() + 5 * 86400000)),
      signature: 'signed',
      status: 'verified',
    },
    {
      id: 'tender',
      name: 'Tender Notice',
      version: 'v1.0',
      size: '340 KB',
      uploadedBy: 'Admin Portal',
      uploadedAt: fmt(base),
      signature: 'signed',
      status: 'verified',
    },
    {
      id: 'spec',
      name: 'Technical Specification',
      version: 'v3.2',
      size: '5.1 MB',
      uploadedBy: 'Er. Priya Sundar',
      uploadedAt: fmt(new Date(base.getTime() + 2 * 86400000)),
      signature: 'signed',
      status: 'verified',
    },
    {
      id: 'safety',
      name: 'Safety Manual',
      version: 'v1.0',
      size: '1.2 MB',
      uploadedBy: 'Safety Cell',
      uploadedAt: fmt(new Date(base.getTime() + 8 * 86400000)),
      signature: 'pending',
      status: 'pending',
    },
    {
      id: 'qc',
      name: 'Quality Checklist',
      version: 'v1.1',
      size: '890 KB',
      uploadedBy: 'QC Division',
      uploadedAt: fmt(new Date(base.getTime() + 10 * 86400000)),
      signature: 'pending',
      status: 'pending',
    },
  ];
}

function buildTimeline(order: GovOrderDetail): RfqTimelineStep[] {
  const floated = order.floatedAt ? new Date(order.floatedAt) : null;
  const bidClose = order.bidCloseAt ? new Date(order.bidCloseAt) : null;
  const steps: RfqTimelineStep[] = [
    {
      id: 'created',
      label: 'RFQ Created',
      date: floated ? floated.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
      actor: 'Er. Priya Sundar',
      role: 'Executive Engineer',
      done: Boolean(floated),
      active: order.status === 'DRAFT',
    },
    {
      id: 'invite',
      label: 'Vendor Invitation',
      date: floated
        ? new Date(floated.getTime() + 2 * 86400000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '—',
      actor: 'System Auto',
      role: 'Notification',
      done: order.status !== 'DRAFT',
      active: order.status === 'FLOATED',
    },
    {
      id: 'bid',
      label: 'Bid Submission',
      date: bidClose
        ? new Date(bidClose.getTime() - 86400000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '—',
      actor: 'Portal Open',
      role: 'Sealed bids',
      done: ['REVEALING', 'AWARDED'].includes(order.status),
      active: order.status === 'FLOATED',
    },
    {
      id: 'closing',
      label: 'Bid Closing',
      date: bidClose
        ? bidClose.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—',
      actor: 'Er. Priya Sundar',
      role: 'District Officer',
      done: ['REVEALING', 'AWARDED'].includes(order.status),
      active: order.status === 'FLOATED' && Boolean(bidClose),
    },
    {
      id: 'tech',
      label: 'Technical Evaluation',
      date: bidClose
        ? new Date(bidClose.getTime() + 4 * 86400000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '—',
      actor: 'Er. Rajesh Kumar',
      role: 'Assistant Engineer',
      done: order.status === 'AWARDED',
      active: order.status === 'REVEALING',
    },
    {
      id: 'financial',
      label: 'Financial Evaluation',
      date: '25 May 2025',
      actor: 'Finance Cell',
      role: 'Treasury',
      done: order.status === 'AWARDED',
      active: false,
    },
    {
      id: 'award',
      label: 'Award',
      date: order.award
        ? new Date(order.award.awardedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '01 Jun 2025',
      actor: order.award?.vendorName ?? 'CE, Coimbatore',
      role: 'Award authority',
      done: order.status === 'AWARDED',
      active: false,
    },
  ];
  return steps;
}

function buildActivity(order: GovOrderDetail): RfqActivityItem[] {
  const items: RfqActivityItem[] = [];
  if (order.floatedAt) {
    items.push({
      id: 'pub',
      type: 'system',
      title: 'RFQ published to vendor portal',
      subtitle: 'Er. Priya Sundar · Executive Engineer',
      when: new Date(order.floatedAt).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
    items.push({
      id: 'inv',
      type: 'invitation',
      title: '12 vendors invited via portal',
      subtitle: 'System · Auto Notification',
      when: new Date(new Date(order.floatedAt).getTime() + 2 * 86400000).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  }
  items.push({
    id: 'doc',
    type: 'document',
    title: 'Technical Drawing Package uploaded (v1.4)',
    subtitle: 'Er. Rajesh Kumar · Assistant Engineer',
    when: '15 Apr, 02:20 PM',
  });
  items.push({
    id: 'lab',
    type: 'lab',
    title: 'Assigned for Cube Compressive Strength test',
    subtitle: 'NABL Lab CBE · Laboratory',
    when: '18 Apr, 10:00 AM',
  });
  items.push({
    id: 'rem',
    type: 'reminder',
    title: 'Reminder sent to 3 pending vendors',
    subtitle: 'System · Auto Reminder',
    when: '05 May, 09:00 AM',
  });
  items.push({
    id: 'note',
    type: 'comment',
    title: 'Field note: Column formwork inspection complete',
    subtitle: 'Er. Rajesh Kumar · Assistant Engineer',
    when: '08 May, 04:45 PM',
  });
  return items;
}

export function buildRfqDetailViewModel(order: GovOrderDetail): RfqDetailViewModel {
  const days = daysUntil(order.bidCloseAt);
  const budget = estimateBudgetCr(order.items);
  const participation = participationFromBids(order.bids);
  const labTests = labTestRows(order.items, order.requiredBy);
  const labDone = labTests.filter((t) => t.status === 'completed').length;
  const docs = staticDocuments(order.floatedAt);

  return {
    rfqCode: rfqCode(order),
    title: order.milestone,
    statusLabel: order.status.replace(/_/g, ' '),
    daysToClose: days,
    closeHint:
      days != null && days > 0
        ? `Bid window closes in ${days} day${days === 1 ? '' : 's'}`
        : order.status === 'FLOATED'
          ? 'Bid closing window active'
          : order.status,
    estimatedBudgetCr: budget.budget,
    budgetDelta: budget.delta,
    invitedVendors: participation.invited,
    vendorResponsePct: participation.responsePct,
    labTestsCount: labTests.length,
    labTestsDone: labDone,
    description:
      'Construction of reinforced concrete columns for elevated road corridor including formwork, reinforcement fabrication, and concrete pour with quality monitoring.',
    meta: {
      concreteGrade: 'M40',
      quantity: `${order.items.reduce((s, i) => s + i.quantity, 0) * 400} Cu.m`,
      projectLength: '12.4 km',
      location: `${order.orgName} Ring Road, NH-948`,
      duration: '18 months',
      safetyClass: 'Class A – High Risk',
      workType: `Structural – ${order.stageCode.replace(/_/g, ' ')}`,
      priority: 'HIGH',
    },
    scopeText:
      'Project context for procurement officers — sealed tender for accredited laboratories within service radius, aligned with IS-code testing calendar and milestone quality gates.',
    documents: docs,
    labTests,
    participation,
    timeline: buildTimeline(order),
    activity: buildActivity(order),
  };
}
