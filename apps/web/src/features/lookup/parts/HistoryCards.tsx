import { useId } from 'react';
import type { HistoryTrip, LookupDeferral, LookupHistory } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { CARD, Chip } from '@/features/live/parts/ui';
import { plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import {
  NOTHING_NOT_DELIVERED, NO_CONFIRMATIONS, NO_DEFERRALS, RETURN_INSTRUCTED, clockTime, deferralName, tripName, unitsWords, whole,
} from '../words';
import { ICON } from './icons';

// History's rail beside the selected trip (Dispatcher · History 112:78211): what was not delivered, kept apart from the
// orders the plan deferred; the shops' confirmations, one per confirmed stop; and the deferrals themselves.

const TITLE = 'text-[15px] leading-5 font-bold';
const placeOf = (name: string, brand: string) => (name.startsWith(`${brand} `) ? name.slice(brand.length + 1) : name);

// Closed shops and refused goods, with whether the depot said to bring them back. Deferred orders are not here.
export function NotDelivered({ trips, onOpen }: { trips: HistoryTrip[]; onOpen: (tripId: string, trigger?: HTMLElement) => void }) {
  const stops = trips.flatMap((trip) => trip.stops
    .filter((stop) => stop.outcome === 'closed' || (stop.stages.refused.units ?? 0) > 0 || stop.flags.returned)
    .map((stop) => ({ trip, stop })));
  const title = useId();
  return (
    <section aria-labelledby={title} className={cn(CARD, 'px-5 pt-[18px] pb-4')}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.waiting} alt="" className="size-[26px] object-contain" />
        <h2 id={title} className={TITLE}>Not delivered · {whole(stops.length)}</h2>
      </div>
      {stops.length === 0 ? <p className="mt-2.5 text-xs leading-4 text-muted-foreground">{NOTHING_NOT_DELIVERED}</p> : (
        <ol className="mt-2">
          {stops.map(({ trip, stop }) => {
            const brand = stop.outlet.brand;
            const what = stop.outcome === 'closed'
              ? `nobody there · ${stop.stages.notDelivered.units === null ? 'not recorded' : `${unitsWords(brand, stop.stages.notDelivered.units)} not delivered`}`
              : `${stop.stages.refused.units === null ? 'refusal not recorded' : `${unitsWords(brand, stop.stages.refused.units)} refused`}`;
            return (
              <li key={stop.id} className="flex items-start justify-between gap-3 py-[7px]">
                <button type="button" onClick={(event) => onOpen(trip.tripId, event.currentTarget)} className="min-w-0 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="block text-xs leading-4 font-semibold">{stop.outlet.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-[15px] text-muted-foreground">{what} · {tripName(trip)}</span>
                </button>
                {stop.flags.returned && <Chip tone="bad" className="mt-0.5">{RETURN_INSTRUCTED}</Chip>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// The shops' confirmations by time: each a stop confirmed once, named by its time and place, never "Signed".
export function Confirmations({ read, onOpen }: { read: LookupHistory; onOpen: (tripId: string, trigger?: HTMLElement) => void }) {
  const receipts = read.trips
    .flatMap((trip) => trip.stops.flatMap((stop) => (stop.receipt ? [{ trip, stop, receipt: stop.receipt }] : [])))
    .sort((a, b) => a.receipt.confirmedAt.localeCompare(b.receipt.confirmedAt));
  const title = useId();
  return (
    <section aria-labelledby={title} className={cn(CARD, 'px-5 pt-[18px] pb-4')}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.proof} alt="" className="size-[26px] object-contain" />
        <h2 id={title} className={TITLE}>Shop confirmations · {whole(read.counts?.confirmations ?? 0)}</h2>
      </div>
      {receipts.length === 0 ? <p className="mt-2.5 text-xs leading-4 text-muted-foreground">{NO_CONFIRMATIONS}</p> : (
        <ol className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-3">
          {receipts.map(({ trip, stop, receipt }) => (
            <li key={stop.id}>
              <button
                type="button"
                onClick={(event) => onOpen(trip.tripId, event.currentTarget)}
                aria-label={`${stop.outlet.name}, confirmed ${clockTime(receipt.confirmedAt)}`}
                className="flex w-full flex-col items-center gap-1 rounded-[10px] bg-muted px-2 py-2.5 outline-none hover:bg-border/70 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <img src={ICON.proof} alt="" className="size-6 object-contain" />
                <span className="font-mono text-[10px] leading-3">{clockTime(receipt.confirmedAt)}</span>
                <span className="max-w-full truncate text-[10px] leading-3">{placeOf(stop.outlet.name, stop.outlet.brand)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// The plan's deferrals in the rail: the first few, and the whole list in place of the trips on demand.
export function DeferredCard({ deferrals, onShowAll }: { deferrals: LookupDeferral[]; onShowAll: () => void }) {
  const first = deferrals.slice(0, 4);
  const title = useId();
  return (
    <section aria-labelledby={title} className={cn(CARD, 'px-5 pt-[18px] pb-4')}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.waiting} alt="" className="size-[26px] object-contain" />
        <h2 id={title} className={TITLE}>Deferred · {whole(deferrals.length)}</h2>
      </div>
      {deferrals.length === 0 ? <p className="mt-2.5 text-xs leading-4 text-muted-foreground">{NO_DEFERRALS}</p> : (
        <>
          <ol className="mt-2">
            {first.map((deferral) => (
              <li key={deferral.orderId} className="py-[7px]">
                <p className="text-xs leading-4 font-semibold">{deferral.outlet.name}</p>
                <p className="mt-0.5 text-[11px] leading-[15px] text-muted-foreground">{deferral.reason || deferralName(deferral.code)}</p>
              </li>
            ))}
          </ol>
          {deferrals.length > first.length && (
            <Button variant="outline" className={plainButton('mt-1 h-8 rounded-full px-3 text-[11px]')} onClick={onShowAll}>
              Show all {whole(deferrals.length)} deferred orders
            </Button>
          )}
        </>
      )}
    </section>
  );
}

const COLUMNS = 'grid grid-cols-[minmax(150px,1fr)_76px_56px_96px_minmax(220px,1.6fr)] items-baseline gap-x-2.5';

// Deferred in place of the trips: every order the sent plan deferred, with its shop and reason, including any that a
// later plan delivered. No next date is promised.
export function DeferralList({ deferrals, total }: { deferrals: LookupDeferral[]; total: number }) {
  if (deferrals.length === 0) return <p role="status" className={cn(CARD, 'px-5 py-4 text-[13px] leading-[18px] font-semibold')}>{NO_DEFERRALS}</p>;
  return (
    <div className={cn(CARD, 'min-w-[680px] px-4 pt-3 pb-2')}>
      <p className="px-2 pb-2 text-[11px] leading-[14px] text-muted-foreground">
        {deferrals.length === total ? `${whole(total)} deferred ${total === 1 ? 'order' : 'orders'} on this sent plan` : `${whole(deferrals.length)} of ${whole(total)} deferred orders on this sent plan`}
      </p>
      <div role="table" aria-label="Deferred orders">
        <div role="row" className={cn(COLUMNS, 'px-2 pb-1 text-[10px] leading-3 font-semibold text-muted-foreground')}>
          <span role="columnheader">Shop</span><span role="columnheader">Order</span><span role="columnheader">Temp</span>
          <span role="columnheader">Units</span><span role="columnheader">Reason</span>
        </div>
        {deferrals.map((deferral) => (
          <div key={deferral.orderId} role="row" className={cn(COLUMNS, 'rounded-[10px] px-2 py-1.5 text-[11px] leading-[15px] hover:bg-muted/70')}>
            <span role="cell" className="text-xs leading-4 font-semibold">{deferral.outlet.name}</span>
            <span role="cell" className="font-mono text-muted-foreground" title={deferral.orderId}>{deferral.orderId.slice(0, 8)}</span>
            <span role="cell">{deferral.temp}</span>
            <span role="cell">{unitsWords(deferral.outlet.brand, deferral.units)}</span>
            <span role="cell"><span className="font-semibold text-warn-ink">{deferralName(deferral.code)}</span> · {deferral.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
