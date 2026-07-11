import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDate } from '@/lib/time';
import {
  useConstructionStages,
  useCreateGovOrder,
  useGenerateRequirements,
  useGovProjects,
  useProjectRequirements,
} from './useGov';

const SUPERSTRUCTURE_QTY = [
  { key: 'm3', labelKey: 'planner.qtyM3' },
  { key: 'consignment', labelKey: 'planner.qtyConsignment' },
  { key: 'heat', labelKey: 'planner.qtyHeat' },
  { key: 'pour', labelKey: 'planner.qtyPour' },
] as const;

export function PlannerPage() {
  const { t } = useTranslation();
  const { data: projects, isPending: projectsPending } = useGovProjects();
  const { data: stages } = useConstructionStages();

  const [projectId, setProjectId] = useState('');
  const [stageCode, setStageCode] = useState('SUPERSTRUCTURE');
  const [quantities, setQuantities] = useState({ m3: '120', consignment: '3', heat: '2', pour: '1' });
  const [milestone, setMilestone] = useState('Superstructure pour — M1');
  const [error, setError] = useState<string | null>(null);

  const activeProject = projectId || projects?.[0]?.id || '';
  const { data: requirements, isPending: reqPending } = useProjectRequirements(activeProject);
  const generate = useGenerateRequirements(activeProject);
  const createOrder = useCreateGovOrder(activeProject);

  const stageReqs = useMemo(
    () => (requirements ?? []).filter((r) => r.stageCode === stageCode && r.status === 'PLANNED'),
    [requirements, stageCode],
  );

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed: Record<string, number> = {};
    for (const { key } of SUPERSTRUCTURE_QTY) {
      const n = Number(quantities[key]);
      if (!Number.isFinite(n) || n < 0) {
        setError(t('planner.invalidQty'));
        return;
      }
      parsed[key] = n;
    }
    try {
      await generate.mutateAsync({ stageCode, quantities: parsed });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('planner.generateFailed'));
    }
  }

  async function onCreateRfq() {
    setError(null);
    if (stageReqs.length === 0) {
      setError(t('planner.noRequirements'));
      return;
    }
    try {
      await createOrder.mutateAsync({
        projectId: activeProject,
        stageCode,
        milestone: milestone.trim(),
        requirementIds: stageReqs.map((r) => r.id),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('planner.createFailed'));
    }
  }

  if (projectsPending) return <FeedSkeleton />;

  return (
    <section className="space-y-6">
      <div className="gov-card overflow-hidden">
        <div className="border-b border-hair bg-navy px-6 py-4 text-white">
          <h2 className="font-display text-xl font-bold">{t('planner.title')}</h2>
          <p className="mt-1 text-sm text-white/80">{t('planner.subtitle')}</p>
        </div>

        <form onSubmit={onGenerate} className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="gov-label">{t('planner.project')}</span>
              <select
                className="gov-input mt-1"
                value={activeProject}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="gov-label">{t('planner.stage')}</span>
              <select
                className="gov-input mt-1"
                value={stageCode}
                onChange={(e) => setStageCode(e.target.value)}
              >
                {(stages ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SUPERSTRUCTURE_QTY.map(({ key, labelKey }) => (
              <label key={key} className="block">
                <span className="gov-label">{t(labelKey)}</span>
                <input
                  type="number"
                  min={0}
                  step={key === 'm3' ? 'any' : 1}
                  className="gov-input mt-1"
                  value={quantities[key]}
                  onChange={(e) => setQuantities((q) => ({ ...q, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          {error && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="gov-btn-primary" disabled={generate.isPending}>
              {generate.isPending ? t('planner.generating') : t('planner.generate')}
            </button>
          </div>
        </form>
      </div>

      <div className="gov-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-6 py-4">
          <div>
            <h3 className="font-display text-lg font-bold">{t('planner.calendar')}</h3>
            <p className="text-sm text-ink-2">{t('planner.calendarHint')}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[12rem]">
              <span className="gov-label">{t('planner.milestone')}</span>
              <input
                className="gov-input mt-1"
                value={milestone}
                onChange={(e) => setMilestone(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="gov-btn-secondary"
              disabled={createOrder.isPending || stageReqs.length === 0}
              onClick={() => void onCreateRfq()}
            >
              {createOrder.isPending ? t('planner.creating') : t('planner.createRfq')}
            </button>
          </div>
        </div>

        {reqPending ? (
          <div className="p-6">
            <FeedSkeleton />
          </div>
        ) : (requirements ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-3">{t('planner.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('planner.colTest')}</th>
                  <th className="px-6 py-3 font-semibold">{t('planner.colStage')}</th>
                  <th className="px-6 py-3 font-semibold">{t('planner.colSamples')}</th>
                  <th className="px-6 py-3 font-semibold">{t('planner.colDue')}</th>
                  <th className="px-6 py-3 font-semibold">{t('planner.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {(requirements ?? []).map((r) => (
                  <tr key={r.id} className={r.status === 'PLANNED' ? 'bg-surface' : 'bg-surface-2/50'}>
                    <td className="px-6 py-3">
                      <span className="font-medium text-ink">{r.testName}</span>
                      <span className="ml-2 font-mono text-xs text-ink-3">{r.testCode}</span>
                    </td>
                    <td className="px-6 py-3 text-ink-2">{r.stageName}</td>
                    <td className="px-6 py-3 font-mono">{r.plannedCount}</td>
                    <td className="px-6 py-3">{r.requiredBy ? formatDate(r.requiredBy) : '—'}</td>
                    <td className="px-6 py-3">
                      <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-semibold uppercase text-ink-3">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-ink-3">
        {t('planner.nextStep')}{' '}
        <Link to="/gov/orders" className="font-semibold text-navy hover:underline">
          {t('planner.ordersLink')} →
        </Link>
      </p>
    </section>
  );
}
