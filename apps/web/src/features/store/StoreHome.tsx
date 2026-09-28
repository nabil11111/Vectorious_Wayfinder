import { ClipboardList, Clock, LifeBuoy, Truck } from 'lucide-react';
import { AppShell, ComingNext, type NavItem } from '@/components/layout/AppShell';

export const STORE_NAV: NavItem[] = [
  { to: '/store', label: 'Today', icon: <Clock className="size-6" /> },
  { to: '/store/orders', label: 'Orders', icon: <ClipboardList className="size-6" /> },
  { to: '/store/deliveries', label: 'Deliveries', icon: <Truck className="size-6" /> },
  { to: '/store/help', label: 'Help', icon: <LifeBuoy className="size-6" /> },
];

export function StoreHome() {
  return (
    <AppShell nav={STORE_NAV}>
      <ComingNext title="Today" what="Today's deliveries, the late one first, and the next order with its 16:00 cut-off. Figma: Shop · Today (phone and desktop)." />
    </AppShell>
  );
}
