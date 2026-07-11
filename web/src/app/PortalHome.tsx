import { Navigate } from 'react-router-dom';
import { useSession } from '@/auth/useSession';
import { devUserById } from '@/app/devUsers';
import { portalHomePathForSession, resolvePortal } from '@/types/domain';

export function PortalHome() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="mx-auto max-w-portal px-4 py-24 text-center text-sm text-ink-3">
        …
      </div>
    );
  }

  if (session?.authenticated) {
    const portal = resolvePortal(session) ?? devUserById(session.userId)?.portal;
    if (portal) return <Navigate to={portalHomePathForSession(session)} replace />;
  }

  return <Navigate to="/sign-in" replace />;
}
