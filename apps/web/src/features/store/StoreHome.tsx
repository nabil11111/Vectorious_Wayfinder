import { Navigate, Route, Routes } from 'react-router';
import { AppShell, ComingNext, type NavItem } from '@/components/layout/AppShell';
import { HelpPage } from './HelpPage';
import { NewOrderPage } from './NewOrderPage';
import { useNextOrder } from './next-order';
import { OrdersPage } from './OrdersPage';
import { OrdersPlacedPage } from './OrdersPlacedPage';
import { ICON } from './parts/icons';
import { TodayPage } from './TodayPage';

// The design's own tab pictures. AppShell marks the open tab with aria-current, and the picture follows it:
// full colour when open, faded when not.
const tabIcon = (src: string) => <img src={src} alt="" className="size-[26px] opacity-50 [[aria-current=page]_&]:opacity-100" />;

export const STORE_NAV: NavItem[] = [
  { to: '/store', label: 'Today', icon: tabIcon(ICON.today) },
  { to: '/store/orders', label: 'Orders', icon: tabIcon(ICON.orders) },
  { to: '/store/deliveries', label: 'Deliveries', icon: tabIcon(ICON.deliveries) },
  { to: '/store/help', label: 'Help', icon: tabIcon(ICON.help) },
];

// The store manager's area (spec 009). The router hands over everything under /store, so the area's own
// routes live here. Deliveries is piece A5 and keeps its placeholder until then.
export function StoreHome() {
  const next = useNextOrder();

  return (
    <AppShell nav={STORE_NAV} place={next.data?.outlet.name}>
      <Routes>
        <Route index element={<TodayPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/placed" element={<OrdersPlacedPage />} />
        <Route path="deliveries" element={<ComingNext title="Deliveries" what="Confirm what arrived and report anything short or damaged. Figma: Shop · Confirm delivery." />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/store" replace />} />
      </Routes>
    </AppShell>
  );
}
