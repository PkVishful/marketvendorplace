import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession, useSignOut } from '@/auth/useSession';
import { devUserById } from '@/app/devUsers';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { useTheme } from '@/hooks/useTheme';
import { primaryOrgScope, vendorNavForSession } from '@/lib/navConfig';
import {
  useNotifications,
  unreadCount,
} from '@/features/notifications/useNotifications';

export function VendorLayout() {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const dev = devUserById(session?.userId);
  const { data: notifications } = useNotifications({
    enabled: Boolean(session?.authenticated),
  });

  const navItems = vendorNavForSession(session).map((item) => ({
    to: item.to,
    label: t(item.labelKey),
    end: item.end,
  }));

  function handleSignOut() {
    signOut.mutate(undefined, { onSuccess: () => navigate('/sign-in') });
  }

  function handleLangChange(code: string) {
    void i18n.changeLanguage(code);
    localStorage.setItem('eworks-lang', code);
  }

  const orgScope = session?.authenticated
    ? `Tamil Nadu › ${session.vendorName ?? primaryOrgScope(session)}`
    : undefined;

  return (
    <DashboardShell
      portal="vendor"
      homePath="/vendor"
      navItems={navItems}
      userName={dev?.label ?? session?.fullName}
      orgScope={orgScope}
      notificationHref="/vendor/notifications"
      notificationCount={unreadCount(notifications)}
      theme={theme}
      onToggleTheme={toggleTheme}
      lang={i18n.language}
      onLangChange={handleLangChange}
      onSignOut={handleSignOut}
    >
      <div className="mx-auto max-w-portal">
        <Outlet />
      </div>
    </DashboardShell>
  );
}
