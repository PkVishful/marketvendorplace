import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TnDistrictMap, type MapRegion } from '@/components/dashboard/districtMaps/TnDistrictMap';
import { PERFORMANCE_COLORS, performanceFromScore } from '@/components/dashboard/districtMaps/types';
import type { AreaChild } from './api';

const NO_DATA_COLOR = '#94a3b8';

function scoreStyle(score: number | null) {
  const color = score == null ? NO_DATA_COLOR : PERFORMANCE_COLORS[performanceFromScore(score)];
  return { color, backgroundColor: `${color}18` };
}

/**
 * District map with a detail pane, per the reference layout.
 *
 * Selection is local state rather than a route: picking a district here is
 * "show me its numbers", which is a different intent from drilling into it —
 * the card's own link still does that.
 */
export function DistrictMapSection({ districts }: { districts: AreaChild[] }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const regions: MapRegion[] = districts.map((d) => ({ id: d.id, name: d.name, score: d.score }));
  const selected = districts.find((d) => d.id === selectedId) ?? null;

  const stats = selected
    ? [
        { label: t('districtMap.openOrders'), value: selected.kpis.openOrders },
        { label: t('districtMap.activeJobs'), value: selected.kpis.activeJobs },
        { label: t('districtMap.labsEngaged'), value: selected.kpis.vendorsActive },
        {
          label: t('districtMap.quality'),
          value: selected.score != null ? `${selected.score}%` : t('districtMap.noData'),
        },
      ]
    : [];

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-sm font-bold text-ink">{t('districtMap.title')}</h2>
        <Link to="/gov/orders" className="text-sm text-brand hover:underline">
          {t('districtMap.viewAll')}
        </Link>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="h-[420px]">
          <TnDistrictMap
            regions={regions}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId((prev) => (prev === r.id ? null : r.id))}
          />
        </div>

        <div className="min-w-0">
          {selected ? (
            <>
              <h3 className="font-display text-sm font-bold text-ink">
                {t('districtMap.detailTitle', { district: selected.name })}
              </h3>
              <p className="mt-0.5 text-xs text-ink-3">
                {selected.kpis.openOrders === 0
                  ? t('districtMap.noOrdersYet')
                  : t('districtMap.ordersSummary', { count: selected.kpis.openOrders })}
              </p>

              <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {stats.map((s) => (
                  <li key={s.label} className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-ink-3">{s.label}</p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{s.value}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate">{t('districtMap.pickPrompt')}</p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-line text-[10px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="py-2 pr-3">{t('districtMap.colDistrict')}</th>
                  <th className="py-2 pr-3 text-right">{t('districtMap.colOpen')}</th>
                  <th className="py-2 pr-3 text-right">{t('districtMap.colActive')}</th>
                  <th className="py-2 pr-3 text-right">{t('districtMap.colCerts')}</th>
                  <th className="py-2 text-right">{t('districtMap.colScore')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(selected ? [selected] : districts).map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`cursor-pointer ${d.id === selectedId ? 'bg-brand-tint/40' : 'hover:bg-surface-2'}`}
                  >
                    <td className="py-2 pr-3 font-medium text-ink">{d.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.kpis.openOrders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.kpis.activeJobs}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.kpis.certificates30d}</td>
                    <td className="py-2 text-right">
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                        style={scoreStyle(d.score)}
                      >
                        {d.score != null ? `${d.score}%` : t('districtMap.noData')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
