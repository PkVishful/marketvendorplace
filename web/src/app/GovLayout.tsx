import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession, useSignOut } from '@/auth/useSession';
import { devUserById } from '@/app/devUsers';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { RoleDashboard } from '@/features/gov/RoleDashboard';
import { useTheme } from '@/hooks/useTheme';
import { govNavForSession, primaryOrgScope, primaryRoleLabel } from '@/lib/navConfig';

export function GovLayout() {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const dev = devUserById(session?.userId);

  const navItems = govNavForSession(session).map((item) => ({
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
    ? `Tamil Nadu › ${primaryOrgScope(session)}`
    : undefined;

  return (
    <DashboardShell
      portal="gov"
      homePath="/gov"
      navItems={navItems}
      userName={dev?.label ?? session?.fullName}
      roleLabel={session?.authenticated ? primaryRoleLabel(session) : undefined}
      orgScope={orgScope}
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

export function GovHomePage() {
  return <RoleDashboard />;
}
