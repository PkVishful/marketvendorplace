import { describe, it, expect } from 'vitest';
import { buildSetupGroups, overallProgress, type SetupInputs } from './setupTasks';
import { emptyOrgProfile } from '@/features/admin/orgProfile';

function inputs(over: Partial<SetupInputs> = {}): SetupInputs {
  return {
    orgProfile: emptyOrgProfile(),
    userCount: 0,
    rolesWithPermissions: 0,
    pendingVendorApprovals: 0,
    navVisibilityConfigured: false,
    projectsWithRequirements: 0,
    ...over,
  };
}

describe('buildSetupGroups', () => {
  it('marks every configuration task as outstanding on a fresh deployment', () => {
    const all = buildSetupGroups(inputs()).flatMap((g) => g.tasks);
    expect(all.length).toBeGreaterThan(0);
    // 'vendor-approvals' is a queue, not a configuration step: an empty queue
    // is already the finished state, so it is excluded here by design rather
    // than nagging an admin about vendors that do not exist yet.
    const configTasks = all.filter((t) => t.id !== 'vendor-approvals');
    expect(configTasks.every((task) => !task.done)).toBe(true);
  });

  it('completes the organisation-details task only when name and location are both set', () => {
    const find = (i: SetupInputs) =>
      buildSetupGroups(i).flatMap((g) => g.tasks).find((t) => t.id === 'org-details')!;

    expect(find(inputs()).done).toBe(false);
    expect(find(inputs({ orgProfile: { ...emptyOrgProfile(), name: 'TN PWD' } })).done).toBe(false);
    expect(find(inputs({
      orgProfile: { ...emptyOrgProfile(), name: 'TN PWD', location: 'India' },
    })).done).toBe(true);
  });

  it('treats a whitespace-only organisation name as not done', () => {
    const task = buildSetupGroups(inputs({
      orgProfile: { ...emptyOrgProfile(), name: '   ', location: 'India' },
    })).flatMap((g) => g.tasks).find((t) => t.id === 'org-details')!;
    expect(task.done).toBe(false);
  });

  it('completes the logo task from the stored logo', () => {
    const task = buildSetupGroups(inputs({
      orgProfile: { ...emptyOrgProfile(), logoDataUrl: 'data:image/png;base64,AAA' },
    })).flatMap((g) => g.tasks).find((t) => t.id === 'org-logo')!;
    expect(task.done).toBe(true);
  });

  it('counts the vendor-approval task as done only when the queue is empty', () => {
    const find = (n: number) =>
      buildSetupGroups(inputs({ pendingVendorApprovals: n }))
        .flatMap((g) => g.tasks).find((t) => t.id === 'vendor-approvals')!;

    // An empty queue is the finished state; a non-empty one shows the backlog.
    expect(find(0).done).toBe(true);
    expect(find(7).done).toBe(false);
    expect(find(7).badge).toBe(7);
  });

  it('reports per-group counts for the tab labels', () => {
    const groups = buildSetupGroups(inputs({
      orgProfile: { ...emptyOrgProfile(), name: 'TN PWD', location: 'India' },
    }));
    const org = groups.find((g) => g.id === 'organisation')!;
    expect(org.doneCount).toBe(1);
    expect(org.total).toBe(org.tasks.length);
  });

  it('gives every task a destination to act on', () => {
    for (const task of buildSetupGroups(inputs()).flatMap((g) => g.tasks)) {
      expect(task.to).toMatch(/^\//);
      expect(task.titleKey).toBeTruthy();
    }
  });
});

describe('overallProgress', () => {
  it('counts only the empty vendor queue on a fresh deployment', () => {
    const progress = overallProgress(buildSetupGroups(inputs()));
    expect(progress.done).toBe(1);
    expect(progress.total).toBeGreaterThan(1);
    expect(progress.pct).toBeGreaterThan(0);
  });

  it('reaches 100 when every task is satisfied', () => {
    const groups = buildSetupGroups(inputs({
      orgProfile: {
        ...emptyOrgProfile(), name: 'TN PWD', location: 'India',
        logoDataUrl: 'data:image/png;base64,AAA',
      },
      userCount: 12,
      rolesWithPermissions: 6,
      pendingVendorApprovals: 0,
      navVisibilityConfigured: true,
      projectsWithRequirements: 3,
    }));
    const progress = overallProgress(groups);
    expect(progress.done).toBe(progress.total);
    expect(progress.pct).toBe(100);
  });

  it('rounds a partial figure rather than showing a long decimal', () => {
    const groups = buildSetupGroups(inputs({ userCount: 5 }));
    const progress = overallProgress(groups);
    expect(Number.isInteger(progress.pct)).toBe(true);
    expect(progress.pct).toBeGreaterThan(0);
    expect(progress.pct).toBeLessThan(100);
  });
});
