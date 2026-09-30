import { Route, Routes } from 'react-router';
import { AppShell, ComingNext, type NavItem } from '@/components/layout/AppShell';
import { VehiclesPage } from './VehiclesPage';

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Users' },
  { to: '/admin/vehicles', label: 'Vehicles' },
  { to: '/admin/outlets', label: 'Outlets' },
  { to: '/admin/products', label: 'Products' },
];

export function AdminHome() {
  return (
    <AppShell nav={ADMIN_NAV}>
      <Routes>
        <Route index element={<ComingNext title="Users" what="Add, edit and archive accounts. Vehicles, outlets and products follow the same list-and-form pattern." />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        {/* The tabs not built yet say so, instead of showing an empty page. */}
        <Route path="*" element={<ComingNext title="Coming next" what="This admin page is not built yet. It follows the same list-and-form pattern as Vehicles." />} />
      </Routes>
    </AppShell>
  );
}
