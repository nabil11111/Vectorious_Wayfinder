import { Navigate, Outlet } from 'react-router';
import type { Role } from '@wayfinder/contracts';
import { Wordmark } from '@/components/layout/Wordmark';
import { Button } from '@/components/ui/button';
import { HOME, useMe } from './api';

// Wraps a role's routes. Signed out goes to sign in; the wrong role goes to its own home. The API checks
// roles again on every request, so this is for the screen, not for security.
export function RequireRole({ roles }: { roles: Role[] }) {
  const me = useMe();
  if (me.isPending) return null;
  // A check that failed is not a sign-out: the person may still be signed in with the server out of reach.
  if (me.isError) return <CannotReach busy={me.isFetching} onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!roles.includes(me.data.role) && me.data.role !== 'admin') return <Navigate to={HOME[me.data.role]} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const me = useMe();
  if (me.isPending) return null;
  if (me.isError) return <CannotReach busy={me.isFetching} onRetry={() => void me.refetch()} />;
  return <Navigate to={me.data ? HOME[me.data.role] : '/login'} replace />;
}

// The screen goes back to its page by itself once the check passes, on Try again, on focus or when the
// device comes back online.
function CannotReach({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div role="alert" className="w-full max-w-sm space-y-6 rounded-2xl bg-card p-6 shadow-sm sm:p-8">
        <Wordmark className="h-7" />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Could not reach Wayfinder</h1>
          <p className="text-sm text-muted-foreground">Check the connection and try again.</p>
        </div>
        <Button size="xl" className="w-full" disabled={busy} onClick={onRetry}>
          {busy ? 'Trying…' : 'Try again'}
        </Button>
      </div>
    </main>
  );
}
