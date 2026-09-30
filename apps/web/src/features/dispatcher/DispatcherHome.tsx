import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell, ComingNext, type NavItem } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';
import { PlanBoardPage } from '@/features/plan/PlanBoardPage';
import { ViewPlanPage } from '@/features/plan/ViewPlanPage';
import { DepotSwitch } from './DepotSwitch';

export const DISPATCHER_NAV: NavItem[] = [
  { to: '/dispatcher', label: 'Dashboard' },
  { to: '/dispatcher/plan', label: 'Plan board' },
  { to: '/dispatcher/live', label: 'Live day' },
  { to: '/dispatcher/orders', label: 'Orders' },
  { to: '/dispatcher/history', label: 'History' },
  { to: '/dispatcher/fleet', label: 'Fleet' },
];

// The dispatcher's area. The router hands over everything under /dispatcher, so the area's own routes live here.
// The plan board and View plan are spec 010; the other tabs keep their placeholders until their pieces.
export function DispatcherHome() {
  const { data: me } = useMe();
  const depot = me?.depotId ?? null;
  // The plan board's three columns use the whole width of a large screen.
  const wide = useLocation().pathname.startsWith('/dispatcher/plan');

  return (
    <AppShell nav={DISPATCHER_NAV} place={depot ?? undefined} bar={depot && <DepotSwitch depot={depot} />} wide={wide}>
      <Routes>
        <Route index element={<ComingNext title="Dashboard" what="Tiles for today, what needs you, and the trucks out now." />} />
        <Route path="plan" element={<PlanBoardPage />} />
        <Route path="plan/:date" element={<ViewPlanPage />} />
        <Route path="live" element={<ComingNext title="Live day" what="The trucks on the road and what needs an answer." />} />
        <Route path="orders" element={<ComingNext title="Orders" what="Every order of the depot and where it is." />} />
        <Route path="history" element={<ComingNext title="History" what="Days already delivered." />} />
        <Route path="fleet" element={<ComingNext title="Fleet" what="The depot's vehicles and their weeks." />} />
        <Route path="*" element={<Navigate to="/dispatcher" replace />} />
      </Routes>
    </AppShell>
  );
}
