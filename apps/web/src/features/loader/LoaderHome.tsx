import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';
import { FlagPage } from './FlagPage';
import { TruckPage } from './TruckPage';
import { TrucksPage } from './TrucksPage';

// The loader's area (spec 012). The router hands over everything under /loader, so the area's own routes live here:
// Today's trucks, a truck, and a flag on one of its stops. The loader frames draw no tabs.
export function LoaderHome() {
  const { data: me } = useMe();
  return (
    <AppShell place={me?.depotId ? `${me.depotId} dock` : undefined} wide>
      {/* The tablet frame's width: the page runs 24 px from the edges of the 1180 px dock tablet, and no wider on a
          bigger screen. */}
      <div className="mx-auto w-full max-w-[1132px]">
        <Routes>
          <Route index element={<TrucksPage />} />
          <Route path="trucks/:tripId" element={<TruckPage />} />
          <Route path="trucks/:tripId/flag" element={<FlagPage />} />
          <Route path="*" element={<Navigate to="/loader" replace />} />
        </Routes>
      </div>
    </AppShell>
  );
}
