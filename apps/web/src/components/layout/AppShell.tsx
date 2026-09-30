import type { ReactNode } from 'react';
import { Bell, LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import { Button } from '@/components/ui/button';
import { ROLE_LABEL, useLogout, useMe } from '@/features/auth/api';
import { useAppClock } from '@/lib/clock';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';
import { DemoClock } from './DemoClock';
import { Wordmark } from './Wordmark';

export type NavItem = { to: string; label: string; icon?: ReactNode };

// One shell for every role, matching the Figma top bars. On a phone the nav becomes bottom tabs (shop); on a
// desktop it sits in the top bar (dispatcher, shop on a desktop). Loader and driver pass no nav at all.
export function AppShell({ nav = [], place, children }: { nav?: NavItem[]; place?: string; children: ReactNode }) {
  const { data: me } = useMe();
  const logout = useLogout();
  // The app's own time, never the device's, and the stream that keeps every open screen current (spec 008).
  const clock = useAppClock();
  useLive();
  if (!me) return null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card px-4 py-3 md:px-6">
        <span className="font-mono text-2xl font-bold tabular-nums md:hidden">{clock.time}</span>
        <DemoClock clock={clock} as="sheet" className="md:hidden" />
        <Wordmark className="hidden md:inline-flex" />
        {nav.length > 0 && (
          <nav className="ml-4 hidden gap-1 md:flex">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="flex-1" />
        <span className="hidden font-mono text-lg font-bold tabular-nums md:inline">{clock.time}</span>
        <DemoClock clock={clock} as="panel" className="hidden md:inline-flex" />
        <button type="button" aria-label="Notifications" className="rounded-full p-1.5 hover:bg-muted"><Bell className="size-6" /></button>
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-bold">{me.displayName}</div>
          <div className="text-xs text-muted-foreground">{ROLE_LABEL[me.role]}{place ? ` · ${place}` : ''}</div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => logout.mutate()}><LogOut /></Button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>

      {nav.length > 0 && (
        <nav className="sticky bottom-0 grid border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${nav.length}, 1fr)` }}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2 text-xs', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

// Placeholder body for screens nobody has built yet. Delete it from a screen once that screen is real.
export function ComingNext({ title, what }: { title: string; what: string }) {
  return (
    <section className="space-y-2 rounded-2xl bg-card p-6 shadow-sm">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{what}</p>
    </section>
  );
}
