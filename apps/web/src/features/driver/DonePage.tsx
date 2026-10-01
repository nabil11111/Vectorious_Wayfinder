import type { DriverDay, DriverTrip } from '@wayfinder/contracts';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { newWriteId } from '@/features/loader/loading';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { ICON } from './parts/icons';
import { TopArea } from './parts/TopArea';
import { TopLines } from './parts/TopLine';
import { ActionBar, Band, BIG, Card, Problem } from './parts/ui';
import { useSave } from './sender';
import type { DriverView } from './view';
import {
  aboutTrip, backAtLine, checkedInLine, handBack, headBackLine, nextTripLine, NOT_SAVED, SIGN_OUT_WAITS, tripClosedLine, tripRows, type Figures,
} from './words';

// The trip's card, the hand-back card and the next trip's row, which Trip done and Day done both show.
function TripCards({ day, trip, figures }: { day: DriverDay; trip: DriverTrip; figures: Figures }) {
  const back = handBack(trip, figures);
  const next = nextTripLine(day, trip);
  return (
    <>
      <Card className="mt-[23px] space-y-2.5 px-3.5 py-[15px]">
        {tripRows(trip, figures).map((row) => (
          <p key={row.label} className="flex items-baseline justify-between gap-4 text-[13px] leading-4">
            <span className="shrink-0 font-semibold">{row.label}</span>
            <span className="min-w-0 text-right font-mono text-muted-foreground">{row.value}</span>
          </p>
        ))}
      </Card>
      <div className="mt-3 rounded-[14px] bg-warn-tint px-3.5 pt-4 pb-[18px] shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
        <p className="flex items-center gap-2.5 text-sm leading-[18px] font-semibold">
          <img src={ICON.damaged} alt="" className="size-[22px] shrink-0 object-contain" />
          {back.title}
        </p>
        {back.text && <p className="mt-2.5 text-xs leading-[17px]">{back.text}</p>}
      </div>
      <Card className="mt-3 flex items-center justify-between gap-3 px-3.5 py-[15px] text-[13px] leading-4">
        <span className="font-semibold">{next.label}</span>
        <span className="text-muted-foreground">{next.value}</span>
      </Card>
    </>
  );
}

// Driver · Trip done, · refused and · shop closed at /driver (spec 013, rules 7 and 9): every stop delivered, refused or
// closed, the counts that add up, what is still on the truck, and "I'm back at the depot".
export function TripDone({ view, day, trip, figures }: { view: DriverView; day: DriverDay; trip: DriverTrip; figures: Figures }) {
  const { at } = useAppClock();
  const { save, saving, failed } = useSave();
  const finish = () => {
    if (at === null) return;
    void save({ kind: 'finish', writeId: newWriteId(), tripId: trip.tripId, at: new Date(at).toISOString(), revision: trip.revision }, aboutTrip(trip, 'finish'));
  };
  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords}>
        <TopLines day={day} trip={trip} figures={figures} waiting={view.waiting} waitingRecords={view.waitingRecords} noSignalBar={false} />
      </TopArea>
      {failed && <Problem>{NOT_SAVED}</Problem>}
      <h1 className="text-[26px] leading-8 font-bold">Trip done</h1>
      <p className="mt-4 text-sm leading-[18px] font-semibold text-muted-foreground">{headBackLine(day, trip)}</p>
      <TripCards day={day} trip={trip} figures={figures} />
      <ActionBar>
        <Button className={BIG()} disabled={saving || at === null} focusableWhenDisabled onClick={finish}>
          {saving ? 'Saving…' : "I'm back at the depot"}
        </Button>
      </ActionBar>
    </div>
  );
}

// Driver · Day done at /driver once every trip of the day is done: the closed trip, and "Sign out", which waits until
// everything on the phone is sent.
export function DayDone({ view, day, trip, figures }: { view: DriverView; day: DriverDay; trip: DriverTrip; figures: Figures }) {
  const logout = useLogout();
  const waiting = view.waitingRecords;
  return (
    <div>
      <TopArea waitingRecords={waiting}>
        <Band tone={waiting > 0 ? 'warn' : 'good'} className="flex min-h-[33px] items-center gap-2 py-2">
          {waiting === 0 && <Check className="size-3.5 shrink-0 stroke-[2.5] text-good" aria-hidden="true" />}
          <p role="status" className={cn('text-xs leading-4 font-semibold', waiting > 0 && 'text-warn-ink')}>{tripClosedLine(figures, waiting)}</p>
        </Band>
      </TopArea>
      {logout.isError && <Problem>Could not sign out. Check the connection and try again.</Problem>}
      <h1 className="text-[26px] leading-8 font-bold">{backAtLine(day)}</h1>
      <p className="mt-4 text-sm leading-[18px] font-semibold text-muted-foreground">{checkedInLine(trip)}</p>
      <TripCards day={day} trip={trip} figures={figures} />
      <ActionBar>
        {waiting > 0 && <p className="text-center text-[13px] leading-4 text-muted-foreground">{SIGN_OUT_WAITS}</p>}
        <Button className={BIG()} disabled={waiting > 0 || logout.isPending} focusableWhenDisabled onClick={() => logout.mutate()}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
      </ActionBar>
    </div>
  );
}
