import { Navigate, Outlet } from 'react-router';
import type { Role } from '@wayfinder/contracts';
import { HOME, useMe } from './api';

// Wraps a role's routes. Signed out goes to sign in; the wrong role goes to its own home. The API checks
// roles again on every request, so this is for the screen, not for security.
export function RequireRole({ roles }: { roles: Role[] }) {
  const { data: me, isPending } = useMe();
  if (isPending) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (!roles.includes(me.role) && me.role !== 'admin') return <Navigate to={HOME[me.role]} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const { data: me, isPending } = useMe();
  if (isPending) return null;
  return <Navigate to={me ? HOME[me.role] : '/login'} replace />;
}
