import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell, type NavItem } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';
import { shopQueue } from '@/lib/phone/shop';
import { DeliveriesPage } from './DeliveriesPage';
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
// routes live here. The shop's queue starts when the area opens (spec 015, rule 6, D-57): the tab that owns it
// fetches, keeps and sends the shop's receipts whichever shop page it shows, and Deliveries waits for that tab.
export function StoreHome() {
  const next = useNextOrder();
  const { data: me } = useMe();
  const owner = shopQueue.useOwner();

  return (
    <AppShell nav={STORE_NAV} place={next.data?.outlet.name}>
      {owner === 'owner' && me?.outletId && <ShopQueue userId={me.id} />}
      <Routes>
        <Route index element={<TodayPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/placed" element={<OrdersPlacedPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        <Route path="deliveries/:stopId" element={<DeliveriesPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/store" replace />} />
      </Routes>
    </AppShell>
  );
}

// The shop's queue for the signed-in account, in the tab that owns it: its account, and the query under its key whose
// orders, clock and demo messages and minute's refetch start the loop's fetch.
function ShopQueue({ userId }: { userId: string }) {
  useEffect(() => { shopQueue.setAccount({ id: userId }); }, [userId]);
  shopQueue.useQueueQuery();
  return null;
}
