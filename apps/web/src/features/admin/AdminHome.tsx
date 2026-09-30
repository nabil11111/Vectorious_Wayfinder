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
      </Routes>
    </AppShell>
  );
}
