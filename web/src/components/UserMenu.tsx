import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function UserMenu({
  name,
  roleLabel,
  onSignOut,
}: {
  name?: string;
  roleLabel?: string;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((p) => !p)}
        className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-2 py-1.5 text-left hover:bg-white/15 sm:px-3"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-xs font-bold text-brand-dark">
          {initials}
        </span>
        <span className="hidden max-w-[120px] truncate text-xs font-medium sm:block">{name}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] rounded-xl border border-line bg-surface py-1 shadow-card"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            {roleLabel && <p className="mt-0.5 text-xs text-slate">{roleLabel}</p>}
          </div>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-danger hover:bg-danger-bg"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {t('dev.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
