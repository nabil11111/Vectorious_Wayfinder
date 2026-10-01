import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import type { Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { newWriteId } from '@/features/loader/loading';
import { useAppClock } from '@/lib/clock';
import { ICON } from './parts/icons';
import { PhotoInput } from './parts/PhotoInput';
import { TopArea } from './parts/TopArea';
import { ActionBar, BIG, PLAIN, Problem, StopHead } from './parts/ui';
import { UNUSABLE, usePhoto } from './photo';
import { useSave } from './sender';
import { hasSignal } from './signal';
import { useDriverView } from './view';
import { aboutStop, brandOf, NOT_SAVED, stopOfLine } from './words';

// Driver · Proof and · photo preview at /driver/proof?stop= (spec 013, D-47): a photo of the cartons at the door, then
// "Save delivery". The delivery is saved on the phone first, with the photo inside the write, and the screen goes on:
// straight to the next stop with a signal, or to "Saved on this phone" without one.
export function ProofPage({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const stopId = params.get('stop') ?? '';
  // A photo belongs to one stop.
  return <Proof key={stopId} me={me} stopId={stopId} />;
}

function Proof({ me, stopId }: { me: Me; stopId: string }) {
  const view = useDriverView(me.id);
  const navigate = useNavigate();
  const { at } = useAppClock();
  const { save, saving, failed } = useSave();
  const { photo, unusable, reading, take, inputRef, pick } = usePhoto();
  // Set while the delivery saves, so the stop being done does not send the screen back before it moves on.
  const [leaving, setLeaving] = useState(false);

  if (!view.ready) return null;
  const { trip, figures } = view;
  const stop = trip?.stops.find((s) => s.id === stopId);
  if (!trip || !stop || !figures) return <Navigate to="/driver" replace />;
  if (!leaving && (trip.status !== 'out' || stop.arrivedAt === null || stop.outcome !== null)) return <Navigate to="/driver" replace />;

  // Every line as loaded, with the photo, at the app clock's time (rule 4).
  const deliver = async () => {
    if (!photo || at === null) return;
    setLeaving(true);
    const saved = await save({ kind: 'deliver', writeId: newWriteId(), tripId: trip.tripId, stopId: stop.id, at: new Date(at).toISOString(), revision: stop.revision, photo }, aboutStop(stop));
    if (!saved) {
      setLeaving(false);
      return;
    }
    navigate(hasSignal() ? '/driver' : `/driver/saved?stop=${stop.id}`, { replace: true });
  };

  return (
    <div className="flex min-h-[calc(100dvh-93px)] flex-col">
      <TopArea waitingRecords={view.waitingRecords} />
      {failed && <Problem>{NOT_SAVED}</Problem>}
      {unusable && <Problem>{UNUSABLE}</Problem>}
      <StopHead stopLine={stopOfLine(stop, figures)} stop={stop} brand={brandOf(trip, stop)} sub={photo ? 'Check that the cartons are visible' : 'Photo of the cartons at the door'} />
      <div className="mt-3 flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-[10px] border-[1.5px] border-dashed border-muted-foreground/50 bg-border">
        {photo
          ? <img src={photo} alt="The cartons at the door" className="max-h-full w-full object-contain" />
          : <img src={ICON.proofPhoto} alt="" className="size-[62px] object-contain" />}
      </div>
      <PhotoInput inputRef={inputRef} onPick={pick} />
      <ActionBar>
        {photo ? (
          <>
            <Button className={BIG()} disabled={saving || at === null} focusableWhenDisabled onClick={() => { void deliver(); }}>{saving ? 'Saving…' : 'Save delivery'}</Button>
            <Button variant="outline" className={PLAIN()} disabled={saving} onClick={take}>Retake photo</Button>
          </>
        ) : (
          <Button className={BIG()} disabled={reading} focusableWhenDisabled onClick={take}>{reading ? 'Reading the photo…' : 'Take photo'}</Button>
        )}
      </ActionBar>
    </div>
  );
}
