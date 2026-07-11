import type { ReactNode } from 'react';
import { usePermission } from '@/auth/permissions';

interface Props {
  /** Permission code, or any-of an array, that reveals the children. */
  perm: string | string[];
  children: ReactNode;
  /** Rendered when the permission is not held. Defaults to nothing. */
  fallback?: ReactNode;
}

// Show `children` only when the session holds `perm`.
//
// UX ONLY. This hides affordances the user cannot use; it is NOT a security
// boundary. RLS is the real gate — a hidden action still fails closed if
// invoked directly.
export function PermissionGate({ perm, children, fallback = null }: Props) {
  const allowed = usePermission(perm);
  return <>{allowed ? children : fallback}</>;
}
