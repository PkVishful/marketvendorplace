import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import type { ChecklistStage, ChecklistTest } from '@/types/domain';
import { useCatalogChecklist } from './useCatalog';
import { useVendorOffers, type VendorOffer } from './useVendorOffers';

// UI affordances, not catalog data — the tests themselves always come from the
// API. The order mirrors the domain slugs the endpoint emits.
const DOMAINS = [
  'soil', 'concrete', 'cement', 'aggregate', 'steel', 'weld', 'masonry',
  'road/bitumen', 'waterproofing', 'finishes', 'electrical', 'plumbing', 'fire', 'hvac', 'water',
];

function matches(test: ChecklistTest, q: string): boolean {
  if (!q) return true;
  const hay = `${test.name} ${test.code} ${test.isCode ?? ''}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function ChecklistScreen({ variant }: { variant: 'gov' | 'vendor' }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useCatalogChecklist();
  const { offers, available } = useVendorOffers(variant === 'vendor');
  const showOffers = variant === 'vendor' && available;

  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string | null>(null);
  const [nablOnly, setNablOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!data) return [];
    const filter = (tests: ChecklistTest[]) =>
      tests.filter((x) => matches(x, query)
        && (!domain || x.domain === domain)
        && (!nablOnly || x.requiresNabl));
    const stageGroups = data.stages.map((s) => ({ ...s, tests: filter(s.tests) }));
    const cross: ChecklistStage = {
      code: '__ANY__', sequence: 99, name: t('catalog.anyLevel'), tests: filter(data.crossStage),
    };
    return [...stageGroups, cross].filter((g) => g.tests.length > 0);
  }, [data, query, domain, nablOnly, t]);

  if (isPending) return <FeedSkeleton />;
  if (isError) {
    return (
      <section className="gov-card border-l-4 border-l-danger p-4">
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary">
          {t('states.retry')}
        </button>
      </section>
    );
  }

  const allExpanded = collapsed.size === 0;
  const toggle = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <section className="print-sheet space-y-4">
      <header className="print:mb-4">
        <h2 className="font-display text-xl font-bold text-ink">{t('catalog.title')}</h2>
        <p className="text-sm text-ink-2">
          {t(variant === 'vendor' ? 'catalog.subtitleVendor' : 'catalog.subtitleGov')}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <input
          type="search" aria-label={t('catalog.search')} value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('catalog.search')}
          className="gov-input min-w-[16rem] flex-1"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={nablOnly} onChange={(e) => setNablOnly(e.target.checked)} />
          {t('catalog.nablOnly')}
        </label>
        <button
          type="button" className="gov-btn-secondary"
          onClick={() => setCollapsed(allExpanded ? new Set(groups.map((g) => g.code)) : new Set())}
        >
          {allExpanded ? t('catalog.collapseAll') : t('catalog.expandAll')}
        </button>
        <button type="button" className="gov-btn-primary" onClick={() => window.print()}>
          {t('catalog.print')}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 print:hidden">
        {DOMAINS.map((d) => (
          <button
            key={d} type="button"
            aria-pressed={domain === d}
            onClick={() => setDomain(domain === d ? null : d)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              domain === d ? 'border-navy bg-navy text-white' : 'border-hair text-ink-2'
            }`}
          >
            {t(`catalog.domain.${d}`)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="gov-card p-6 text-center text-sm text-ink-2">{t('catalog.empty')}</div>
      ) : (
        groups.map((stage) => {
          const open = allExpanded || !collapsed.has(stage.code);
          return (
            <div key={stage.code} className="gov-card overflow-hidden print:break-before-page">
              <button
                type="button" onClick={() => toggle(stage.code)} aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 p-4 text-left"
              >
                <span className="font-display text-base font-bold text-ink">{stage.name}</span>
                <span className="text-xs font-semibold text-ink-3">
                  {t('catalog.count', { count: stage.tests.length })}
                </span>
              </button>
              <ul className={`divide-y divide-hair border-t border-hair ${open ? '' : 'hidden print:block'}`}>
                {stage.tests.map((test) => (
                  <ChecklistRow
                    key={`${stage.code}-${test.code}`} test={test}
                    showOffers={showOffers} offer={offers.get(test.code)}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function ChecklistRow({
  test, showOffers, offer,
}: {
  test: ChecklistTest;
  showOffers: boolean;
  offer: VendorOffer | undefined;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
      <span className="text-sm font-semibold text-ink">{test.name}</span>
      <span className="font-mono text-xs text-ink-3">{test.code}</span>
      {test.isCode && <span className="chip">{test.isCode}</span>}
      {test.requiresNabl && <span className="chip chip-nabl">{t('catalog.nabl')}</span>}
      <span className="text-xs text-ink-2">{t(test.frequency.key, test.frequency.params)}</span>
      {test.tatDays != null && <span className="text-xs text-ink-3">{t('catalog.tat', { days: test.tatDays })}</span>}
      {test.repeatsAcrossStages && <span className="chip chip-muted">{t('catalog.repeats')}</span>}
      {showOffers && (
        <span className="ml-auto flex items-center gap-1.5">
          {offer?.offered ? (
            <>
              <span className="chip chip-ok">{t('catalog.youOffer')}</span>
              {offer.priceLabel ? (
                <span className="chip chip-ok">{t('catalog.priced', { price: offer.priceLabel })}</span>
              ) : (
                <Link to="/vendor/rates" className="chip chip-muted hover:underline">{t('catalog.notPriced')}</Link>
              )}
            </>
          ) : (
            <Link to="/vendor/onboarding" className="chip chip-muted hover:underline">{t('catalog.notOffered')}</Link>
          )}
        </span>
      )}
    </li>
  );
}
