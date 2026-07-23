import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, Building2, Check, ClipboardCheck, FileText, LifeBuoy,
  Map as MapIcon, Rocket, ShieldCheck, Users,
} from 'lucide-react';
import { useSession } from '@/auth/useSession';
import { useAdminSettings, useAdminUsers, useAdminRoles } from '@/features/admin/useAdmin';
import { ORG_PROFILE_KEY, parseOrgProfile } from '@/features/admin/orgProfile';
import { useArea } from '@/features/gov/area/useArea';
import { buildSetupGroups, overallProgress } from './setupTasks';

const TASK_ICONS: Record<string, typeof Building2> = {
  'org-details': Building2,
  'org-logo': FileText,
  'nav-visibility': ShieldCheck,
  officers: Users,
  'role-permissions': ShieldCheck,
  'vendor-approvals': ClipboardCheck,
  'test-requirements': ClipboardCheck,
};

const EXPLORE = [
  { to: '/gov/area', labelKey: 'gettingStarted.exploreArea', descKey: 'gettingStarted.exploreAreaDesc', icon: MapIcon },
  { to: '/gov/checklist', labelKey: 'gettingStarted.exploreChecklist', descKey: 'gettingStarted.exploreChecklistDesc', icon: ClipboardCheck },
  { to: '/gov/analytics', labelKey: 'gettingStarted.exploreAnalytics', descKey: 'gettingStarted.exploreAnalyticsDesc', icon: FileText },
  { to: '/gov/audit', labelKey: 'gettingStarted.exploreAudit', descKey: 'gettingStarted.exploreAuditDesc', icon: ShieldCheck },
];

/** Dismissal is per-browser: it is a nudge, not a stored preference worth a table. */
const HIDDEN_KEY = 'eworks.gettingStarted.hidden';

export function GettingStartedPage() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState('organisation');
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDDEN_KEY) === '1');

  // Every input is a live read; nothing here is remembered client-side.
  const settings = useAdminSettings();
  const users = useAdminUsers('', '', 1);
  const roles = useAdminRoles();
  const area = useArea();

  const groups = useMemo(() => buildSetupGroups({
    orgProfile: parseOrgProfile(settings.data?.find((r) => r.key === ORG_PROFILE_KEY)?.value),
    userCount: users.data?.total ?? 0,
    rolesWithPermissions: (roles.data?.roles ?? []).filter((r) => r.permissions.length > 0).length,
    pendingVendorApprovals: area.data?.summary.pendingApprovals ?? 0,
    navVisibilityConfigured: Boolean(settings.data?.some((r) => r.key === 'nav_visibility')),
    projectsWithRequirements: area.data?.projects.length ?? 0,
  }), [settings.data, users.data, roles.data, area.data]);

  const progress = overallProgress(groups);
  const current = groups.find((g) => g.id === activeTab) ?? groups[0];

  const loading = settings.isPending || users.isPending || roles.isPending || area.isPending;

  if (hidden) {
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <p className="text-sm text-slate">{t('gettingStarted.hiddenNote')}</p>
        <button
          type="button"
          className="gov-btn-secondary mt-3"
          onClick={() => { localStorage.removeItem(HIDDEN_KEY); setHidden(false); }}
        >
          {t('gettingStarted.show')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="relative text-center">
        <button
          type="button"
          className="absolute right-0 top-0 text-sm text-ink-3 hover:text-ink hover:underline"
          onClick={() => { localStorage.setItem(HIDDEN_KEY, '1'); setHidden(true); }}
        >
          {t('gettingStarted.hide')}
        </button>
        <h1 className="font-display text-2xl font-bold text-ink">
          {t('gettingStarted.welcome', { name: session?.fullName ?? '' })}
        </h1>
        <p className="mt-1 text-sm text-ink-2">{t('gettingStarted.subtitle')}</p>
      </header>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
          <Rocket className="h-4 w-4 text-brand" aria-hidden />
          {t('gettingStarted.setupTitle')}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">{t('gettingStarted.completion')}</span>
          <div
            className="h-2 w-32 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuenow={progress.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('gettingStarted.completion')}
          >
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-ink">
            {progress.done}/{progress.total}
          </span>
        </div>
      </section>

      <div className="mt-3 rounded-xl border border-line bg-surface">
        <div role="tablist" aria-label={t('gettingStarted.setupTitle')} className="flex flex-wrap gap-1 border-b border-line px-3 pt-3">
          {groups.map((g) => {
            const active = g.id === current?.id;
            return (
              <button
                key={g.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setActiveTab(g.id)}
                className={`rounded-t-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'border-b-2 border-brand font-semibold text-brand'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {t(g.labelKey)} <span className="tabular-nums text-ink-3">({g.doneCount}/{g.total})</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="px-4 py-6 text-sm text-slate" role="status">{t('gettingStarted.loading')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(current?.tasks ?? []).map((task) => {
              const Icon = TASK_ICONS[task.id] ?? ClipboardCheck;
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                      task.done ? 'bg-success-bg text-success' : 'bg-surface-2 text-ink-3'
                    }`}
                    aria-hidden
                  >
                    {task.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold ${task.done ? 'text-ink-3 line-through' : 'text-ink'}`}>
                      {t(task.titleKey)}
                      {task.badge != null && (
                        <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-bold text-warning">
                          {task.badge}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-ink-3">{t(task.descriptionKey)}</p>
                  </div>

                  <Link
                    to={task.to}
                    className={task.done ? 'gov-btn-secondary text-sm' : 'gov-btn-primary text-sm'}
                  >
                    {task.done ? t('gettingStarted.view') : t(task.ctaKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <h2 className="mt-8 font-display text-base font-bold text-ink">{t('gettingStarted.exploreTitle')}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {EXPLORE.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-brand/40 hover:bg-surface-2"
            >
              <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{t(item.labelKey)}</span>
                <span className="block text-sm text-ink-3">{t(item.descKey)}</span>
              </span>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-display text-base font-bold text-ink">{t('gettingStarted.resourcesTitle')}</h2>
      <div className="mt-3 rounded-xl border border-line bg-surface p-4">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <LifeBuoy className="h-4 w-4 text-brand" aria-hidden />
          {t('gettingStarted.helpTitle')}
        </p>
        <p className="mt-1 text-sm text-ink-3">{t('gettingStarted.helpDesc')}</p>
        <Link to="/gov/help" className="mt-3 inline-block text-sm text-brand hover:underline">
          {t('gettingStarted.helpLink')}
        </Link>
      </div>
    </div>
  );
}
