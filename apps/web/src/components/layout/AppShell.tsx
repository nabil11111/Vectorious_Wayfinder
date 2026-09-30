import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { Role } from '@wayfinder/contracts';
import alertIcon from '@/assets/icons/icon-alert.png';
import dispatcherIcon from '@/assets/icons/icon-person-dispatcher.png';
import driverIcon from '@/assets/icons/icon-person-driver.png';
import loaderIcon from '@/assets/icons/icon-person-loader.png';
import storeManagerIcon from '@/assets/icons/icon-person-store-manager.png';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ROLE_LABEL, useLogout, useMe } from '@/features/auth/api';
import { useAppClock } from '@/lib/clock';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';
import { DemoClock } from './DemoClock';
import { Wordmark } from './Wordmark';

export type NavItem = { to: string; label: string; icon?: ReactNode };

// The design's picture of each role, drawn round beside the name. The admin has none, so takes the dispatcher's.
const AVATAR: Record<Role, string> = { store_manager: storeManagerIcon, dispatcher: dispatcherIcon, loader: loaderIcon, driver: driverIcon, admin: dispatcherIcon };

// One shell for every role, matching the Figma top bars. On a phone the nav becomes bottom tabs (shop); on a
// desktop it sits in the top bar (dispatcher, shop on a desktop). Loader and driver pass no nav at all.
export function AppShell({ nav = [], place, children }: { nav?: NavItem[]; place?: string; children: ReactNode }) {
  const { data: me } = useMe();
  const logout = useLogout();
  // The app's own time, never the device's, and the stream that keeps every open screen current (spec 008).
  const clock = useAppClock();
  useLive();
  if (!me) return null;
  const who = `${ROLE_LABEL[me.role]}${place ? ` · ${place}` : ''}`;

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
        {/* The design's bell, last on a phone. A count never goes into the picture: it will sit over the corner as a
            small badge. */}
        <button type="button" aria-label="Notifications" className="shrink-0 rounded-full p-1 hover:bg-muted max-md:order-last"><img src={alertIcon} alt="" className="size-7" /></button>
        {/* The frames draw no sign-out in the bar, so it sits behind the avatar. */}
        <Popover>
          <PopoverTrigger aria-label={me.displayName} className="flex shrink-0 items-center gap-2.5 rounded-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-border"><img src={AVATAR[me.role]} alt="" className="size-6" /></span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-bold">{me.displayName}</span>
              <span className="block text-xs text-muted-foreground">{who}</span>
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-56 gap-3 p-4">
            <div className="leading-tight">
              <PopoverTitle className="text-sm font-bold">{me.displayName}</PopoverTitle>
              <p className="text-xs text-muted-foreground">{who}</p>
            </div>
            <Button variant="outline" className="h-10 w-full rounded-[10px] bg-card font-semibold dark:border-border dark:bg-card dark:hover:bg-muted" disabled={logout.isPending} onClick={() => logout.mutate()}>
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </PopoverContent>
        </Popover>
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
