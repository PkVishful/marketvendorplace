import { Link } from 'react-router-dom';
import { useSession } from '@/auth/useSession';
import { portalHomePathForSession } from '@/types/domain';

// Rendered by the catch-all routes in App.tsx. Without this, any URL that does
// not exactly match a defined route leaves react-router with nothing to render,
// which shows up as a fully blank page (e.g. a stale link or a typo'd path).
export function NotFoundPage() {
  const { data: session } = useSession();
  const home = session?.authenticated ? portalHomePathForSession(session) : '/';

  return (
    <div className="mx-auto max-w-portal px-4 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-ink-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <Link to={home} className="gov-btn-primary mt-6">
        {session?.authenticated ? 'Back to dashboard' : 'Back to home'}
      </Link>
    </div>
  );
}
