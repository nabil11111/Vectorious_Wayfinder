import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell, type NavItem } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';
import { Bell } from '@/features/live/Bell';
import { LiveDayPage } from '@/features/live/LiveDayPage';
import { PlanBoardPage } from '@/features/plan/PlanBoardPage';
import { ViewPlanPage } from '@/features/plan/ViewPlanPage';
import { OrdersPage } from '@/features/lookup/OrdersPage';
import { HistoryPage } from '@/features/lookup/HistoryPage';
import { FleetPage } from '@/features/lookup/FleetPage';
import { DashboardPage } from './DashboardPage';
import { DepotSwitch } from './DepotSwitch';
import { useFollowSwitches, usePressedDepot } from './depots';
import { SwitchingSkeleton } from './parts/SwitchingSkeleton';
import { scopeName } from './scope';

export const DISPATCHER_NAV: NavItem[] = [
  { to: '/dispatcher', label: 'Dashboard' },
  { to: '/dispatcher/plan', label: 'Plan board' },
  { to: '/dispatcher/live', label: 'Live day' },
  { to: '/dispatcher/orders', label: 'Orders' },
  { to: '/dispatcher/history', label: 'History' },
  { to: '/dispatcher/fleet', label: 'Fleet' },
];

// The dispatcher's area. The router hands over everything under /dispatcher, so the area's own routes live here.
// The plan board and View plan are spec 010, Live day's "Needs you" column and the bell spec 012, and the dashboard and
// the rest of Live day spec 016; the lookup mounts are handed to spec 017's screens builder. The depot is the one the
// dispatcher chose (spec 020), or both together, which the line under the name calls "Both depots" (spec 021), and a
// switch made in another tab of the session is followed here too.
// While a switch is on its way, the loading state stands in place of the page, so no page shows the depot before under
// the depot pressed. The page stays mounted but hidden: a switch that fails brings it back exactly as it was, and one
// that goes through has emptied its reads, so it shows its own loading state until the new depot's arrive.
export function DispatcherHome() {
  const { data: me } = useMe();
  const depot = me?.depotId ?? null;
  const pressed = usePressedDepot();
  useFollowSwitches();
  // The dashboard, the plan board's three columns and Live day use the whole width of a large screen, as their frames do.
  const { pathname } = useLocation();
  const wide = pathname === '/dispatcher' || pathname === '/dispatcher/' || pathname.startsWith('/dispatcher/plan') || pathname.startsWith('/dispatcher/live') || ['/dispatcher/orders', '/dispatcher/history', '/dispatcher/fleet'].includes(pathname);

  return (
    <AppShell nav={DISPATCHER_NAV} place={depot ? scopeName(depot) : undefined} bar={depot && <DepotSwitch depot={depot} />} bell={<Bell />} wide={wide}>
      {pressed !== null && <SwitchingSkeleton depot={pressed} />}
      {/* The page belongs to the depot on show: a switch that goes through starts it afresh, so nothing a page kept for
          the depot before (an answered problem, a selection, an open card) stays under the new one. */}
      <div key={depot ?? 'no depot'} hidden={pressed !== null} className="contents">
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="plan" element={<PlanBoardPage />} />
          <Route path="plan/:date" element={<ViewPlanPage />} />
          <Route path="live" element={<LiveDayPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="fleet" element={<FleetPage />} />
          <Route path="*" element={<Navigate to="/dispatcher" replace />} />
        </Routes>
      </div>
    </AppShell>
  );
}
