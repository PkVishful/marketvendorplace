import { useTranslation } from 'react-i18next';
import { useOversightFlags } from './useOversight';
import type { OversightFlag } from '@/types/domain';

const LABEL_KEY: Record<string, string> = {
  single_bidder: 'oversight.flagSingleBidder',
  award_over_estimate: 'oversight.flagAwardOverEstimate',
  payment_without_certificate: 'oversight.flagIntegrity',
};

export function FlagsPanel({ onSelectOrder }: { onSelectOrder: (id: string) => void }) {
  const { t } = useTranslation();
  const { data: flags = [] } = useOversightFlags();

  return (
    <div className="gov-card p-4">
      <h3 className="font-display text-base font-bold text-ink">{t('oversight.flagsTitle')}</h3>
      {flags.length === 0 ? (
        <p className="mt-2 text-sm text-slate">{t('oversight.flagsEmpty')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {flags.map((f: OversightFlag, i) => (
            <li key={`${f.kind}-${f.orderId}-${i}`}>
              <button
                type="button"
                onClick={() => onSelectOrder(f.orderId)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                  f.severity === 'integrity'
                    ? 'border-danger bg-danger-soft text-danger'
                    : 'border-warn bg-warn-soft text-ink'
                }`}
              >
                <span className="font-medium">{t(LABEL_KEY[f.kind] ?? 'oversight.flagsTitle')}</span>
                <span className="truncate text-xs text-slate">{f.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
