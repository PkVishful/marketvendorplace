// The first-time setup checklist.
//
// Every task's `done` flag is derived from real system state — the stored org
// profile, the actual user and role counts, the live vendor approval queue. A
// checklist that ticks itself off from local state would be decoration; this
// one tells a head admin what is genuinely still unconfigured.

import type { OrgProfile } from '@/features/admin/orgProfile';

export interface SetupInputs {
  orgProfile: OrgProfile;
  userCount: number;
  rolesWithPermissions: number;
  pendingVendorApprovals: number;
  navVisibilityConfigured: boolean;
  projectsWithRequirements: number;
}

export interface SetupTask {
  id: string;
  titleKey: string;
  descriptionKey: string;
  /** Where the CTA sends the admin to actually do it. */
  to: string;
  ctaKey: string;
  done: boolean;
  /** Optional count shown against the task, e.g. an outstanding queue length. */
  badge?: number;
}

export interface SetupGroup {
  id: string;
  labelKey: string;
  tasks: SetupTask[];
  doneCount: number;
  total: number;
}

function group(id: string, labelKey: string, tasks: SetupTask[]): SetupGroup {
  return { id, labelKey, tasks, doneCount: tasks.filter((t) => t.done).length, total: tasks.length };
}

export function buildSetupGroups(input: SetupInputs): SetupGroup[] {
  const p = input.orgProfile;

  return [
    group('organisation', 'gettingStarted.groupOrganisation', [
      {
        id: 'org-details',
        titleKey: 'gettingStarted.orgDetails',
        descriptionKey: 'gettingStarted.orgDetailsDesc',
        to: '/gov/settings/organization/profile',
        ctaKey: 'gettingStarted.configure',
        // Both required fields, or the profile is half-filled and still unusable
        // on a certificate.
        done: Boolean(p.name.trim() && p.location.trim()),
      },
      {
        id: 'org-logo',
        titleKey: 'gettingStarted.orgLogo',
        descriptionKey: 'gettingStarted.orgLogoDesc',
        to: '/gov/settings/organization/profile',
        ctaKey: 'gettingStarted.upload',
        done: Boolean(p.logoDataUrl.trim()),
      },
      {
        id: 'nav-visibility',
        titleKey: 'gettingStarted.navVisibility',
        descriptionKey: 'gettingStarted.navVisibilityDesc',
        to: '/gov/settings/nav-visibility',
        ctaKey: 'gettingStarted.configure',
        done: input.navVisibilityConfigured,
      },
    ]),

    group('people', 'gettingStarted.groupPeople', [
      {
        id: 'officers',
        titleKey: 'gettingStarted.officers',
        descriptionKey: 'gettingStarted.officersDesc',
        to: '/gov/settings/users',
        ctaKey: 'gettingStarted.manage',
        done: input.userCount > 0,
      },
      {
        id: 'role-permissions',
        titleKey: 'gettingStarted.rolePermissions',
        descriptionKey: 'gettingStarted.rolePermissionsDesc',
        to: '/gov/settings/roles',
        ctaKey: 'gettingStarted.review',
        done: input.rolesWithPermissions > 0,
      },
    ]),

    group('quality', 'gettingStarted.groupQuality', [
      {
        id: 'vendor-approvals',
        titleKey: 'gettingStarted.vendorApprovals',
        descriptionKey: 'gettingStarted.vendorApprovalsDesc',
        to: '/gov/vendors',
        ctaKey: 'gettingStarted.review',
        // Done means "nothing waiting" — the badge carries the backlog.
        done: input.pendingVendorApprovals === 0,
        badge: input.pendingVendorApprovals || undefined,
      },
      {
        id: 'test-requirements',
        titleKey: 'gettingStarted.testRequirements',
        descriptionKey: 'gettingStarted.testRequirementsDesc',
        to: '/gov/planner',
        ctaKey: 'gettingStarted.open',
        done: input.projectsWithRequirements > 0,
      },
    ]),
  ];
}

export function overallProgress(groups: SetupGroup[]): { done: number; total: number; pct: number } {
  const done = groups.reduce((n, g) => n + g.doneCount, 0);
  const total = groups.reduce((n, g) => n + g.total, 0);
  return { done, total, pct: total === 0 ? 0 : Math.round((100 * done) / total) };
}
