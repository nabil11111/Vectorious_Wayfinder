import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';
import { NotificationBell } from '@/features/notifications/Bell';
import { usePlanWatch } from './changes';
import { FlagPage } from './FlagPage';
import { PlanChangedPage } from './PlanChangedPage';
import { useOpensAtTop } from './top';
import { TruckPage } from './TruckPage';
import { TrucksPage } from './TrucksPage';

// The loader's area (spec 012). The router hands over everything under /loader, so the area's own routes live here:
// Today's trucks, a truck, a flag on one of its stops, and what changed when the plan was sent again (spec 016). The
// loader frames draw no tabs. Every read of the loading day passes the comparison, whichever page is open, and the
// bell's pop-up keeps "See what changed" at its foot (spec 025). Each page opens at its top (Q-18).
const LOADER_FOOT = { to: '/loader/changes', label: 'See what changed' };

export function LoaderHome() {
  const { data: me } = useMe();
  usePlanWatch();
  useOpensAtTop();
  return (
    <AppShell place={me?.depotId ? `${me.depotId} dock` : undefined} bell={<NotificationBell foot={LOADER_FOOT} />} wide>
      {/* The tablet frame's width: the page runs 24 px from the edges of the 1180 px dock tablet, and no wider on a
          bigger screen. */}
      <div className="mx-auto w-full max-w-[1132px]">
        <Routes>
          <Route index element={<TrucksPage />} />
          <Route path="trucks/:tripId" element={<TruckPage />} />
          <Route path="trucks/:tripId/flag" element={<FlagPage />} />
          <Route path="changes" element={<PlanChangedPage />} />
          <Route path="*" element={<Navigate to="/loader" replace />} />
        </Routes>
      </div>
    </AppShell>
  );
}
