import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { nextStop, type Me } from '@wayfinder/contracts';
import { AppShell } from '@/components/layout/AppShell';
import { keepAccountThroughSignOut, useMe } from '@/features/auth/api';
import { DayDone, TripDone } from './DonePage';
import { NextStopPage } from './NextStopPage';
import { ProofPage } from './ProofPage';
import { SavedPage } from './SavedPage';
import { CouldNotLoad, CouldNotRead, NoTrip, TodaysTrip, TripSkeleton } from './TripPage';
import { UnloadPage } from './UnloadPage';
import { WrongPage } from './WrongPage';
import { holdPictures } from './parts/icons';
import { StatusChip } from './parts/StatusChip';
import { Card } from './parts/ui';
import { setAccount, useDriverQuery, useOwner, useSync } from './sender';
import { useSignal } from './signal';
import { useKept } from './store';
import { useDriverView } from './view';
import { OTHER_TAB } from './words';

// The driver's area (spec 013). The router hands over everything under /driver, so the area's own routes live here:
// /driver shows the screen the trip is at, and /driver/proof, /driver/wrong and /driver/saved the steps of a stop. The
// driver frames draw no tabs. One tab owns the driver's app (rule 10); any other says so and does nothing until that
// one closes. The screens are built at 390 wide and are never wider than 480. While the area is open a 401 keeps the
// account and the screens, and the top of the screen asks the driver to sign in again (AC-45).
export function DriverHome() {
  const { data: me } = useMe();
  const owner = useOwner();
  useEffect(() => keepAccountThroughSignOut(), []);
  return (
    <AppShell place={me?.depotId ?? undefined} status={owner === 'owner' ? <StatusChip /> : undefined}>
      <div className="mx-auto w-full max-w-[480px]">
        {owner === 'other' && <OtherTab />}
        {owner === 'owner' && me && <DriverArea me={me} />}
      </div>
    </AppShell>
  );
}

function OtherTab() {
  return (
    <Card role="status" className="px-5 py-5">
      <p className="text-[15px] leading-5 font-semibold">{OTHER_TAB}</p>
    </Card>
  );
}

function DriverArea({ me }: { me: Me }) {
  const { id } = me;
  useEffect(() => { setAccount({ id }); }, [id]);
  useEffect(() => { holdPictures(); }, []);
  // The query ['driver'] brings the live stream's messages and the minute's refetch to the sync loop.
  useDriverQuery();
  const kept = useKept();
  // The phone could not read what it kept for this account: every route says so until it can.
  if (kept.userId === id && kept.failed) return <CouldNotRead />;
  return (
    <Routes>
      <Route index element={<NowPage me={me} />} />
      <Route path="proof" element={<ProofPage me={me} />} />
      <Route path="wrong" element={<WrongPage me={me} />} />
      <Route path="saved" element={<SavedPage me={me} />} />
      <Route path="*" element={<Navigate to="/driver" replace />} />
    </Routes>
  );
}

// /driver: the first trip that is not done, at its Today's trip until it is out, then its stops, then Trip done, and
// Day done once every trip is done (rule 2). Everything comes from what the phone kept, so it opens with no signal.
function NowPage({ me }: { me: Me }) {
  const view = useDriverView(me.id);
  const { failure } = useSync();
  const signal = useSignal();
  if (!view.ready) return null;
  if (!view.day) return failure !== null || !signal ? <CouldNotLoad view={view} /> : <TripSkeleton />;
  if (!view.trip || !view.figures) return <NoTrip view={view} day={view.day} />;
  if (view.allDone) return <DayDone view={view} day={view.day} trip={view.trip} figures={view.figures} />;
  const { trip, figures } = view;
  if (trip.status !== 'out') return <TodaysTrip view={view} trip={trip} figures={figures} />;
  const next = nextStop(trip);
  if (!next) return <TripDone view={view} day={view.day} trip={trip} figures={figures} />;
  if (next.arrivedAt === null) return <NextStopPage view={view} day={view.day} trip={trip} figures={figures} stop={next} />;
  return <UnloadPage view={view} trip={trip} figures={figures} stop={next} />;
}
