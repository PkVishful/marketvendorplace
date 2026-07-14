import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession, useSignOut } from '@/auth/useSession';
import { GovHeader } from '@/components/GovChrome';
import { GovFooter } from '@/components/GovFooter';
import { OrgScopeBar } from '@/components/OrgScopeBar';
import { DevSignIn } from './DevSignIn';
import { devUserById } from './devUsers';
import {
  primaryOrgScope,
  primaryRoleLabel,
} from '@/lib/navConfig';
import {
  useNotifications,
  unreadCount,
} from '@/features/notifications/useNotifications';
import { portalHomePathForSession, resolvePortal, type Portal, type Session } from '@/types/domain';
import { useTheme } from '@/hooks/useTheme';

function portalForSession(session: Pick<Session, 'userId' | 'portal'>) {
  return resolvePortal(session as Session) ?? devUserById(session.userId)?.portal;
}

function portalFromPath(path: string): 'vendor' | 'gov' | 'contractor' | null {
  if (path.startsWith('/vendor')) return 'vendor';
  if (path.startsWith('/gov')) return 'gov';
  if (path.startsWith('/contractor')) return 'contractor';
  return null;
}

function isDashboardPath(path: string) {
  return path.startsWith('/gov') || path.startsWith('/vendor') || path.startsWith('/contractor');
}

function isPublicPath(path: string) {
  return path.startsWith('/verify');
}

function RequirePortal({ portal }: { portal: Portal }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="mx-auto max-w-portal px-4 py-24 text-center text-sm text-ink-3">
        …
      </div>
    );
  }
  if (!session?.authenticated) {
    return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  }
  if (session.portal !== portal) {
    const home = portalForSession(session);
    if (home) return <Navigate to={portalHomePathForSession(session)} replace />;
    return (
      <div className="mx-auto max-w-portal px-4 py-24 text-center">
        <p className="font-semibold text-ink">No portal role on this account.</p>
        <p className="mt-2 text-sm text-ink-2">Sign out and pick a dev persona, or restart the BFF.</p>
      </div>
    );
  }
  return <Outlet />;
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { data: session, isPending } = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const isSignIn = location.pathname === '/sign-in';
  const isPublic = isPublicPath(location.pathname);
  const activePortal = portalFromPath(location.pathname);
  const useDashboardChrome = isDashboardPath(location.pathname);
  const dev = devUserById(session?.userId);
  const { data: notifications } = useNotifications({
    enabled: Boolean(session?.authenticated && activePortal === 'vendor'),
  });

  function handleSignOut() {
    signOut.mutate(undefined, { onSuccess: () => navigate('/sign-in') });
  }

  function handleLangChange(code: string) {
    void i18n.changeLanguage(code);
    localStorage.setItem('eworks-lang', code);
  }

  const showScope = session?.authenticated && !isPublic && activePortal;
  const orgScope = showScope
    ? `Tamil Nadu › ${primaryOrgScope(session)}`
    : undefined;

  const showLegacyChrome = !isSignIn && !isPublic && !useDashboardChrome;

  return (
    <div
      className={`flex flex-col ${isSignIn ? '' : 'bg-ground'} ${
        useDashboardChrome || isSignIn ? 'h-screen overflow-hidden' : 'min-h-full'
      }`}
    >
      {showLegacyChrome && (
        <>
          <GovHeader
            portal={activePortal}
            userName={dev?.label ?? session?.fullName}
            roleLabel={session?.authenticated ? primaryRoleLabel(session) : undefined}
            notificationHref={
              activePortal === 'vendor' && session?.authenticated
                ? '/vendor/notifications'
                : undefined
            }
            notificationCount={unreadCount(notifications)}
            onSignOut={session?.authenticated ? handleSignOut : undefined}
            theme={theme}
            onToggleTheme={toggleTheme}
            lang={i18n.language}
            onLangChange={handleLangChange}
          />
          {showScope && orgScope && (
            <OrgScopeBar scope={orgScope} roleLabel={primaryRoleLabel(session)} />
          )}
        </>
      )}

      <main
        className={
          useDashboardChrome || isSignIn
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
            : 'flex-1'
        }
      >
        {isSignIn ? (
          isPending ? (
            <div className="px-4 py-24 text-center text-sm text-ink-3">{t('states.loading')}</div>
          ) : session?.authenticated ? (
            (() => {
              const home = portalForSession(session);
              return home ? (
                <Navigate to={portalHomePathForSession(session)} replace />
              ) : (
                <div className="px-4 py-24 text-center text-sm text-ink-2">
                  Signed in, but no portal role was returned. Restart{' '}
                  <code className="text-xs">npm run bff</code> in <code className="text-xs">web/</code>, then sign
                  in again.
                </div>
              );
            })()
          ) : (
            <DevSignIn
              theme={theme}
              onToggleTheme={toggleTheme}
              lang={i18n.language}
              onLangChange={handleLangChange}
            />
          )
        ) : (
          <Outlet />
        )}
      </main>

      {!isSignIn && !useDashboardChrome && <GovFooter />}
    </div>
  );
}

export { RequirePortal };
