import type { ReactNode } from 'react';
import type { Issue, OperationsTrip, StopDetail } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { plainButton } from '@/features/plan/parts/look';
import { brandOfShop, clockTime, truckName, unitsWords, whole } from '@/features/loader/words';
import { cn } from '@/lib/utils';
import { ARRIVED_AFTER_WINDOW, NOT_RECORDED, NOT_RECORDED_PLAN, NOT_RECORDED_YET, placeLine, problemWord } from '../words';
import { isRecorded } from './rows';
import type { RowActions } from './TripRow';

// A trip's details, inline below its row (the Open trip / stop details state, no frame): the sent and recorded times,
// the trip's counts from 013's figures, and per stop its shop, window, times, counts and problems. Every number is
// the read's. The problems link to their cards; there is no photo or proof here (rule 8). Close hands the focus back.
export function TripDetails({ id, trip, issues, actions }: { id: string; trip: OperationsTrip; issues: Issue[] | undefined; actions: RowActions }) {
  const close = (
    <Button variant="outline" className={plainButton('h-8 rounded-full px-4 text-xs')} onClick={() => actions.toggle(trip.tripId)}>Close</Button>
  );
  const head = (
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-[13px] leading-[18px] font-bold">
        {truckName(trip)} · trip {trip.tripNo}{trip.driver ? ` · ${trip.driver.name}` : ''}
        <span className="ml-2 font-sans text-[11px] font-normal text-muted-foreground">{placeLine(trip)}</span>
      </h3>
      {close}
    </div>
  );

  if (!isRecorded(trip)) {
    return (
      <section id={id} aria-label={`${truckName(trip)} details`} className="relative z-[2] mt-1.5 mb-2 rounded-[12px] border bg-card px-4 py-3.5 lg:mx-2">
        {head}
        <p className="mt-2 text-xs leading-4 text-muted-foreground">{NOT_RECORDED_PLAN}</p>
        <ol className="mt-2.5 space-y-1 text-xs leading-4">
          {trip.stops.map((stop) => <li key={stop.id}><span className="font-semibold">{stop.seq} · {stop.shopName}</span> <span className="text-muted-foreground">· {NOT_RECORDED}</span></li>)}
        </ol>
      </section>
    );
  }

  const t = trip.trip;
  const f = trip.figures;
  const brand = trip.brand;
  const units = (n: number) => unitsWords(brand, n);
  const times: [string, string][] = [
    ['Planned leave', clockTime(trip.schedule.leavesAt)],
    ['Left', t.leftAt ? clockTime(t.leftAt) : '–'],
    ['Planned return', clockTime(trip.schedule.backAt)],
    ['Back', t.backAt ? clockTime(t.backAt) : '–'],
    ['Ready', t.readyAt ? clockTime(t.readyAt) : '–'],
    ['Last report', trip.lastReportAt ? clockTime(trip.lastReportAt) : '–'],
  ];
  const counts: [string, string][] = [
    ['Ordered', units(f.ordered)],
    ['Loaded', f.loaded === null ? NOT_RECORDED_YET : units(f.loaded)],
    ...(trip.onSoFar && f.loaded === null ? [['On so far', units(trip.onSoFar.units)] as [string, string]] : []),
    ['Delivered', units(f.delivered)],
    ['Refused', units(f.refused)],
    ['Not delivered', units(f.notDelivered)],
    ['Depot short', f.short === null ? NOT_RECORDED_YET : units(f.short)],
  ];

  return (
    <section id={id} aria-label={`${truckName(trip)} details`} className="relative z-[2] mt-1.5 mb-2 rounded-[12px] border bg-card px-4 py-3.5 lg:mx-2">
      {head}
      <Facts rows={times} className="mt-2.5" />
      <Facts rows={counts} className="mt-1.5" />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[11px] leading-[15px] max-lg:hidden">
          <thead className="text-muted-foreground">
            <tr className="border-b [&>th]:py-1.5 [&>th]:pr-3 [&>th]:font-semibold">
              <th>Stop</th><th>Window</th><th>Planned</th><th>Recorded</th><th>Ordered</th><th>Loaded</th><th>Delivered</th><th>Refused</th><th>Not delivered</th><th>Short</th><th>Problems</th>
            </tr>
          </thead>
          <tbody>
            {trip.stopDetails.map((stop) => (
              <tr key={stop.id} className="border-b last:border-0 [&>td]:py-1.5 [&>td]:pr-3 [&>td]:align-top">
                <td className="font-semibold">{stop.seq} · {stop.shopName}</td>
                <td className="whitespace-nowrap">{clockTime(stop.windowOpen)}–{clockTime(stop.windowClose)}</td>
                <td className="whitespace-nowrap">{clockTime(stop.plannedArrival)}–{clockTime(stop.plannedDeparture)}</td>
                <td><Recorded stop={stop} /></td>
                <td className="font-mono">{whole(stop.figures.ordered)}</td>
                <td className="font-mono">{stop.figures.loaded === null ? '–' : whole(stop.figures.loaded)}</td>
                <td className="font-mono">{whole(stop.figures.delivered)}</td>
                <td className="font-mono">{whole(stop.figures.refused)}</td>
                <td className="font-mono">{whole(stop.figures.notDelivered)}</td>
                <td className="font-mono">{stop.figures.short === null ? '–' : whole(stop.figures.short)}</td>
                <td><Problems stop={stop} issues={issues} actions={actions} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="space-y-2.5 lg:hidden">
        {trip.stopDetails.map((stop) => (
          <li key={stop.id} className="border-t pt-2.5 text-[11px] leading-[15px]">
            <p className="font-semibold">{stop.seq} · {stop.shopName}</p>
            <Facts className="mt-1" rows={[
              ['Window', `${clockTime(stop.windowOpen)}–${clockTime(stop.windowClose)}`],
              ['Planned', `${clockTime(stop.plannedArrival)}–${clockTime(stop.plannedDeparture)}`],
              ['Ordered', unitsWords(brand ?? brandOfShop(stop.shopName), stop.figures.ordered)],
              ['Loaded', stop.figures.loaded === null ? NOT_RECORDED_YET : whole(stop.figures.loaded)],
              ['Delivered', whole(stop.figures.delivered)],
              ['Refused', whole(stop.figures.refused)],
              ['Not delivered', whole(stop.figures.notDelivered)],
              ['Short', stop.figures.short === null ? NOT_RECORDED_YET : whole(stop.figures.short)],
            ]} />
            <div className="mt-1"><Recorded stop={stop} /></div>
            <div className="mt-1"><Problems stop={stop} issues={issues} actions={actions} /></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Facts({ rows, className }: { rows: [string, string][]; className?: string }) {
  return (
    <dl className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-[15px]', className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// "arrived 03:34 · delivered 03:38", with "Arrived after window" when the arrival came after the window closed.
function Recorded({ stop }: { stop: StopDetail }) {
  const parts: ReactNode[] = [
    stop.loadedAt && `loaded ${clockTime(stop.loadedAt)}`,
    stop.arrivedAt && `arrived ${clockTime(stop.arrivedAt)}`,
    stop.doneAt && `${stop.outcome ?? 'done'} ${clockTime(stop.doneAt)}`,
  ].filter(Boolean);
  return (
    <span>
      {parts.length ? parts.join(' · ') : 'nothing yet'}
      {stop.arrivedAfterWindow && <span className="ml-1.5 font-semibold text-warn-ink">{ARRIVED_AFTER_WINDOW}</span>}
    </span>
  );
}

// A stop's problems: an open one links to its card, an answered one says so.
function Problems({ stop, issues, actions }: { stop: StopDetail; issues: Issue[] | undefined; actions: RowActions }) {
  if (stop.issueIds.length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {stop.issueIds.map((id) => {
        const open = issues?.find((issue) => issue.id === id);
        return open ? (
          <button key={id} type="button" onClick={() => actions.decide(id)} className="rounded-full bg-bad-tint px-2 py-0.5 text-[10px] leading-3 font-semibold text-bad underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            {problemWord(open.kind, open)} · Decide
          </button>
        ) : <span key={id} className="text-muted-foreground">{issues ? 'answered' : 'problem'}</span>;
      })}
    </span>
  );
}
