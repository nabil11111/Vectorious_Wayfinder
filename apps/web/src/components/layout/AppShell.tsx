import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { Role } from '@wayfinder/contracts';
import dispatcherIcon from '@/assets/icons/icon-person-dispatcher.png';
import driverIcon from '@/assets/icons/icon-person-driver.png';
import loaderIcon from '@/assets/icons/icon-person-loader.png';
import storeManagerIcon from '@/assets/icons/icon-person-store-manager.png';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ROLE_LABEL, useLogout, useMe } from '@/features/auth/api';
import { NotificationBell } from '@/features/notifications/Bell';
import { useAppClock } from '@/lib/clock';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';
import { DemoClock } from './DemoClock';
import { Wordmark } from './Wordmark';

export type NavItem = { to: string; label: string; icon?: ReactNode };

// A role's home ("/store", "/admin") is the start of every address in its area, so its tab is lit only on the
// home page itself. Every other tab stays lit on the pages under it, such as Orders on "/store/orders/new".
const isHome = (to: string) => to.split('/').filter(Boolean).length === 1;

// The design's picture of each role, drawn round beside the name. The admin has none, so takes the dispatcher's.
const AVATAR: Record<Role, string> = { store_manager: storeManagerIcon, dispatcher: dispatcherIcon, loader: loaderIcon, driver: driverIcon, admin: dispatcherIcon };

// One shell for every role, matching the Figma top bars. Below 1024 wide the nav becomes bottom tabs; from 1024 it
// sits in the top bar (dispatcher, shop on a desktop), where the dispatcher's six tabs need the room. The plan board
// turns its columns into tabs at the same width. Loader and driver pass no nav at all.
// bar is a page's own control in the top bar, such as the dispatcher's depot switch (spec 010). wide lets a page use
// the full width of a large screen, such as the plan board's three columns. bell replaces the plain bell with one that
// keeps a role's own link at the foot of its pop-up, such as the dispatcher's "Open Live day" (spec 025).
export function AppShell({ nav = [], place, bar, bell, status, wide = false, children }: { nav?: NavItem[]; place?: string; bar?: ReactNode; bell?: ReactNode; status?: ReactNode; wide?: boolean; children: ReactNode }) {
  const { data: me } = useMe();
  const logout = useLogout();
  // The app's own time, never the device's, and the stream that keeps every open screen current (spec 008).
  const clock = useAppClock();
  useLive();
  // The avatar menu. Sign out asks the page first; a page that holds it, such as the loader's flag form with a flag not
  // sent (Q-22), asks its own question, and the menu closes so the question is in view.
  const [menu, setMenu] = useState(false);
  if (!me) return null;
  const who = `${ROLE_LABEL[me.role]}${place ? ` · ${place}` : ''}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card px-4 py-3 md:px-6">
        <span className="font-mono text-2xl font-bold tabular-nums lg:hidden">{clock.time}</span>
        {status && <span className="lg:hidden">{status}</span>}
        <DemoClock clock={clock} as="sheet" compact={Boolean(status)} className="lg:hidden" />
        <Wordmark className="hidden lg:inline-flex" />
        {nav.length > 0 && (
          <nav className="ml-4 hidden gap-1 lg:flex">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={isHome(n.to)} className={({ isActive }) => cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="flex-1" />
        {bar && <div className="hidden shrink-0 lg:block">{bar}</div>}
        <span className="hidden font-mono text-lg font-bold tabular-nums lg:inline">{clock.time}</span>
        {status && <span className="hidden lg:inline-flex">{status}</span>}
        <DemoClock clock={clock} as="panel" className="hidden lg:inline-flex" />
        {/* The design's bell, last on a phone, with its red count over the corner: every role's updates (spec 025). */}
        {bell ?? <NotificationBell />}
        {/* The frames draw no sign-out in the bar, so it sits behind the avatar. */}
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger aria-label={me.displayName} className="flex shrink-0 items-center gap-2.5 rounded-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-border"><img src={AVATAR[me.role]} alt="" className="size-6" /></span>
            {/* Between 1024 and 1280 the tabs take the room, so the name waits behind the avatar. */}
            <span className="hidden leading-tight sm:block lg:hidden wide:block">
              <span className="block text-sm font-bold">{me.displayName}</span>
              <span className="block text-xs text-muted-foreground">{who}</span>
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-56 gap-3 p-4">
            <div className="leading-tight">
              <PopoverTitle className="text-sm font-bold">{me.displayName}</PopoverTitle>
              <p className="text-xs text-muted-foreground">{who}</p>
            </div>
            <Button variant="outline" className="h-10 w-full rounded-[10px] bg-card font-semibold dark:border-border dark:bg-card dark:hover:bg-muted" disabled={logout.isPending} onClick={() => { if (!logout.signOut()) setMenu(false); }}>
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </PopoverContent>
        </Popover>
      </header>

      <main className={cn('mx-auto w-full flex-1 p-4 md:p-6', !wide && 'max-w-6xl')}>{children}</main>

      {nav.length > 0 && (
        <nav className="sticky bottom-0 grid border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${nav.length}, 1fr)` }}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={isHome(n.to)} className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2 text-[10px] leading-tight', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
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
