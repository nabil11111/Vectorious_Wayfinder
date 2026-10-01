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
// the rest of Live day spec 016; the lookup mounts are handed to spec 017's screens builder.
export function DispatcherHome() {
  const { data: me } = useMe();
  const depot = me?.depotId ?? null;
  // The dashboard, the plan board's three columns and Live day use the whole width of a large screen, as their frames do.
  const { pathname } = useLocation();
  const wide = pathname === '/dispatcher' || pathname === '/dispatcher/' || pathname.startsWith('/dispatcher/plan') || pathname.startsWith('/dispatcher/live') || ['/dispatcher/orders', '/dispatcher/history', '/dispatcher/fleet'].includes(pathname);

  return (
    <AppShell nav={DISPATCHER_NAV} place={depot ?? undefined} bar={depot && <DepotSwitch depot={depot} />} bell={<Bell />} wide={wide}>
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
    </AppShell>
  );
}
