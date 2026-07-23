import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageNumbers, pageWindow } from '@/lib/pagination';

/**
 * Page controls for any server-paged list.
 *
 * Renders nothing at all for a single page — a lone "1" button is noise, and
 * the row count is already in the caller's header.
 */
export function Pagination({
  total, page, pageSize, onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const win = pageWindow({ total, page, pageSize });

  if (win.totalPages <= 1) return null;

  return (
    <nav
      aria-label={t('pagination.label')}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
    >
      <p className="text-xs text-ink-3" aria-live="polite">
        {t('pagination.showing', { from: win.from, to: win.to, total })}
      </p>

      <ul className="flex items-center gap-1">
        <li>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 disabled:opacity-40 hover:bg-surface-2"
            disabled={!win.hasPrev}
            onClick={() => onPage(win.page - 1)}
            aria-label={t('pagination.previous')}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        </li>

        {pageNumbers(win.totalPages, win.page).map((token, i) =>
          token === 'gap' ? (
            // eslint-disable-next-line react/no-array-index-key -- gaps have no id
            <li key={`gap-${i}`} className="px-1 text-ink-3" aria-hidden>…</li>
          ) : (
            <li key={token}>
              <button
                type="button"
                onClick={() => onPage(token)}
                aria-current={token === win.page ? 'page' : undefined}
                className={`h-8 min-w-8 rounded-lg border px-2 text-sm tabular-nums transition ${
                  token === win.page
                    ? 'border-brand bg-brand text-white font-semibold'
                    : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
                }`}
              >
                {token}
              </button>
            </li>
          ),
        )}

        <li>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 disabled:opacity-40 hover:bg-surface-2"
            disabled={!win.hasNext}
            onClick={() => onPage(win.page + 1)}
            aria-label={t('pagination.next')}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </li>
      </ul>
    </nav>
  );
}
