import { AppShell, ComingNext, type NavItem } from '@/components/layout/AppShell';

export const DISPATCHER_NAV: NavItem[] = [
  { to: '/dispatcher', label: 'Dashboard' },
  { to: '/dispatcher/plan', label: 'Plan board' },
  { to: '/dispatcher/live', label: 'Live day' },
  { to: '/dispatcher/orders', label: 'Orders' },
  { to: '/dispatcher/history', label: 'History' },
  { to: '/dispatcher/fleet', label: 'Fleet' },
];

export function DispatcherHome() {
  return (
    <AppShell nav={DISPATCHER_NAV} place="Peliyagoda">
      <ComingNext title="Dashboard" what="Tiles for today, what needs you, and the trucks out now. Figma: Dispatcher · Dashboard." />
    </AppShell>
  );
}
