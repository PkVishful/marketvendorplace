import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { NavItem } from '@/lib/navConfig';

export function MobileBottomNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('shell.mobileNav')}
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-header md:hidden"
    >
      <ul className="mx-auto flex max-w-portal">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-semibold transition ${
                  isActive ? 'text-brand' : 'text-slate'
                }`
              }
            >
              <span className="text-lg leading-none" aria-hidden="true">
                {item.icon ?? '•'}
              </span>
              <span className="truncate">{t(item.labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
