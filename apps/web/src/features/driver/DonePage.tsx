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
import { useSave } from './queue';
import type { DriverView } from './view';
import {
  aboutTrip, backAtLine, checkedInLine, DAY_TOTAL, dayBrand, dayDoneLine, handBack, headBackLine, nextTripLine, NOT_SAVED, SIGN_OUT_WAITS, tripClosedLine,
  tripLabel, tripRows, type Figures,
} from './words';

// The green band of a closed trip, under the top bar: "✓ Trip closed · 2 of 2 stops · all records sent", or yellow while
// records wait. Day done and the next trip's Today's trip show it (Q-29).
export function ClosedBand({ line, waiting }: { line: string; waiting: number }) {
  return (
    <Band tone={waiting > 0 ? 'warn' : 'good'} className="flex min-h-[33px] items-center gap-2 py-2">
      {waiting === 0 && <Check className="size-3.5 shrink-0 stroke-[2.5] text-good" aria-hidden="true" />}
      <p role="status" className={cn('text-xs leading-4 font-semibold', waiting > 0 && 'text-warn-ink')}>{line}</p>
    </Band>
  );
}

// The hand-back card: "Still on the truck" with what is on it and why, or "Nothing to hand back", and under it "Didn't fit
// on the truck" for what never went on (L-20).
export function HandBackCard({ trip, figures, className }: { trip: DriverTrip; figures: Figures; className?: string }) {
  const back = handBack(trip, figures);
  return (
    <div className={cn('rounded-[14px] bg-warn-tint px-3.5 pt-4 pb-[18px] shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]', className)}>
      <p className="flex items-center gap-2.5 text-sm leading-[18px] font-semibold">
        <img src={ICON.damaged} alt="" className="size-[22px] shrink-0 object-contain" />
        {back.title}
      </p>
      {back.text && <p className="mt-2.5 text-xs leading-[17px]">{back.text}</p>}
      {back.wontFit && (
        <>
          <p className="mt-3.5 flex items-center gap-2.5 text-sm leading-[18px] font-semibold">
            <img src={ICON.shortfall} alt="" className="size-[22px] shrink-0 object-contain" />
            {back.wontFit.title}
          </p>
          <p className="mt-2.5 text-xs leading-[17px]">{back.wontFit.text}</p>
        </>
      )}
    </div>
  );
}

// "Trip 2 · none today", or when the vehicle's next trip leaves.
function NextTripRow({ day, trip }: { day: DriverDay; trip: DriverTrip }) {
  const next = nextTripLine(day, trip);
  return (
    <Card className="mt-3 flex items-center justify-between gap-3 px-3.5 py-[15px] text-[13px] leading-4">
      <span className="font-semibold">{next.label}</span>
      <span className="text-muted-foreground">{next.value}</span>
    </Card>
  );
}

// The trip's card, the hand-back card and the next trip's row, which Trip done and Day done both show.
function TripCards({ day, trip, figures }: { day: DriverDay; trip: DriverTrip; figures: Figures }) {
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
      <HandBackCard trip={trip} figures={figures} className="mt-3" />
      <NextTripRow day={day} trip={trip} />
    </>
  );
}

// A line of the day's card: what it is, and its figures under it.
function DayRow({ label, line, className }: { label: string; line: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[13px] leading-4 font-semibold">{label}</p>
      <p className="mt-1 font-mono text-[13px] leading-[18px] text-muted-foreground">{line}</p>
    </div>
  );
}

// Day done after more than one trip (Q-31): the whole day, a line per trip with its stops, what it delivered of what was
// loaded and what was handed back, the day's totals under them, and the next trip's row.
function DayCards({ day, trip, wholeDay }: { day: DriverDay; trip: DriverTrip; wholeDay: NonNullable<DriverView['wholeDay']> }) {
  return (
    <>
      <Card className="mt-[23px] px-3.5 py-[15px]">
        <div className="space-y-3">
          {wholeDay.byTrip.map((each, i) => (
            <DayRow key={each.tripId} label={tripLabel(each.tripNo)} line={dayDoneLine(each.figures, day.trips[i]?.brand ?? null)} />
          ))}
        </div>
        <DayRow label={DAY_TOTAL} line={dayDoneLine(wholeDay, dayBrand(day.trips))} className="mt-3 border-t pt-3" />
      </Card>
      <NextTripRow day={day} trip={trip} />
    </>
  );
}

// Driver · Trip done, · refused and · shop closed at /driver (spec 013, rules 7 and 9): every stop delivered, refused or
// closed, the counts that add up, what is still on the truck, and "I'm back at the depot".
export function TripDone({ view, day, trip, figures }: { view: DriverView; day: DriverDay; trip: DriverTrip; figures: Figures }) {
  const { at, readNow } = useAppClock();
  const { save, saving, failed } = useSave();
  // At the app clock's time at the press.
  const finish = () => {
    const now = readNow();
    if (now === null) return;
    void save({ kind: 'finish', writeId: newWriteId(), tripId: trip.tripId, at: new Date(now).toISOString(), revision: trip.revision }, aboutTrip(trip, 'finish'));
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
// everything on the phone is sent. After more than one trip it shows the whole day, each trip and the day's totals,
// where the frame draws one trip (Q-31).
export function DayDone({ view, day, trip, figures }: { view: DriverView; day: DriverDay; trip: DriverTrip; figures: Figures }) {
  const logout = useLogout();
  const waiting = view.waitingRecords;
  const wholeDay = view.wholeDay && view.wholeDay.trips > 1 ? view.wholeDay : null;
  return (
    <div>
      <TopArea waitingRecords={waiting}>
        <ClosedBand line={tripClosedLine(figures, waiting, wholeDay ? trip.tripNo : undefined)} waiting={waiting} />
      </TopArea>
      {logout.isError && <Problem>Could not sign out. Check the connection and try again.</Problem>}
      <h1 className="text-[26px] leading-8 font-bold">{backAtLine(day)}</h1>
      <p className="mt-4 text-sm leading-[18px] font-semibold text-muted-foreground">{checkedInLine(trip)}</p>
      {wholeDay ? <DayCards day={day} trip={trip} wholeDay={wholeDay} /> : <TripCards day={day} trip={trip} figures={figures} />}
      <ActionBar>
        {waiting > 0 && <p className="text-center text-[13px] leading-4 text-muted-foreground">{SIGN_OUT_WAITS}</p>}
        <Button className={BIG()} disabled={waiting > 0 || logout.isPending} focusableWhenDisabled onClick={() => logout.mutate()}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
      </ActionBar>
    </div>
  );
}
