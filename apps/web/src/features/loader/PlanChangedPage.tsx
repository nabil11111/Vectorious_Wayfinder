import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { orangeButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import {
  JOINED_TRIP, LEFT_TRIP, NONE_KEPT, NOT_KEPT, SENT_AGAIN, WITHDRAWN, changeTitle, chipsOf, closeChanges, goodsChange, leavesLine, lineAtWords,
  markChangesOpened, pageOf, planChangedLine, stopsLine, usePlanChanges, type ChangeDetail, type ChangeRow, type KeptTrip, type LineAt,
} from './changes';
import { useLoadingDay } from './loading';
import { BackLink } from './parts/LoadCard';
import { NextList } from './parts/TruckRow';
import { Card } from './parts/ui';
import { KeptRefusal } from './TrucksPage';
import { unitsWords } from './words';

// Plan changed at /loader/changes (spec 016, Loader · Plan changed 85:71921): who sent the plan again and when, one
// card per changed trip with what it was above or beside what it is now, the new list with its changed chips, and
// Got it, which returns to the trucks. Only the facts of the two publications this tab read: no reason, dock or
// instruction the dispatcher did not enter. Below 1024 the cards stack, then the list, then Got it full width.
export function PlanChangedPage() {
  const navigate = useNavigate();
  const query = useLoadingDay();
  const changes = usePlanChanges();
  const { kept, failed } = changes;
  const rows = kept?.changes ?? null;
  // Opening the page counts as the notice shown, so the list does not open it again by itself.
  useEffect(() => { if (rows) markChangesOpened(); }, [rows]);
  const back = () => navigate('/loader');
  // While the plan is back in edit the page says to wait, as the list does, and never shows the old cards.
  const page = pageOf(changes, query.data);

  if (page !== 'compare' || !kept || rows === null) {
    return (
      <div className="space-y-3">
        <BackLink to="/loader">Trucks</BackLink>
        <KeptRefusal />
        {failed && <Line tone="warn">{NOT_KEPT}</Line>}
        <Card className="px-5 py-5 lg:max-w-[680px] lg:px-6 lg:py-6">
          <p className="text-[15px] leading-5 font-semibold">{page === 'withdrawn' ? WITHDRAWN : NONE_KEPT}</p>
          <Button className={orangeButton('mt-5 h-[52px] w-full rounded-[12px] text-[15px]')} onClick={back}>Back to trucks</Button>
        </Card>
      </div>
    );
  }

  const gotIt = () => { closeChanges(); back(); };
  const trucks = query.data?.trucks ?? [];
  return (
    <div className="lg:pt-1">
      {/* A stale Start's refusal comes along to this page and stays until dismissed (AC-31). */}
      <KeptRefusal />
      {failed && <div className="mb-3"><Line tone="warn">{NOT_KEPT}</Line></div>}
      <p role="status" className="flex items-center gap-3 rounded-[12px] bg-warn-tint px-4 py-3 text-[15px] leading-5 font-semibold text-warn-ink lg:px-6 lg:py-[13px]">
        <span aria-hidden="true" className="font-bold">!</span>
        {planChangedLine(kept.latest)}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-y-4 lg:mt-[25px] lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:gap-x-6">
        <div className="space-y-3">
          {rows.length === 0
            ? <Card className="px-5 py-5 lg:px-6"><p className="text-[15px] leading-5 font-semibold">{SENT_AGAIN}</p></Card>
            : rows.map((row) => <ChangeCard key={`${row.kind}:${row.before ? `${row.before.vehicleId}#${row.before.tripNo}` : ''}:${row.after ? `${row.after.vehicleId}#${row.after.tripNo}` : ''}`} row={row} />)}
        </div>
        <div className="flex flex-col gap-y-4 lg:min-h-[calc(100dvh-170px)]">
          <NextList trucks={trucks} from={1} changed={chipsOf({ kept, failed }, query.data)} className="lg:-mt-1" />
          <Button className={orangeButton('h-16 w-full rounded-[12px] text-lg lg:mt-auto')} onClick={gotIt}>Got it</Button>
        </div>
      </div>
    </div>
  );
}

function Line({ tone, children }: { tone: 'warn'; children: ReactNode }) {
  return <p role="status" className={cn('rounded-[10px] px-3 py-2.5 text-[13px] leading-4 font-semibold', tone === 'warn' && 'bg-warn-tint text-warn-ink')}>{children}</p>;
}

// One changed trip, as the frame's card: "Kalutara · 41 cartons", then the trip as it was, struck where it changed,
// and the trip as it is now. A trip that is new or taken off says so on its side.
function ChangeCard({ row }: { row: ChangeRow }) {
  const trip = row.after ?? row.before!;
  const changed = new Set<ChangeDetail>(row.details);
  const goods = goodsChange(row);
  // A trip's units are struck only when the total changed, not when orders of the same size changed places.
  const units = row.before !== null && row.after !== null && row.before.units !== row.after.units;
  return (
    <Card ink className="px-5 pt-5 pb-5 lg:px-[26px] lg:pt-[29px] lg:pb-[26px]">
      <h2 className="text-[22px] leading-7 font-bold lg:text-2xl lg:leading-8">{changeTitle(trip)}</h2>
      <div className="mt-4 flex flex-col gap-3 lg:mt-[22px] lg:flex-row lg:items-start lg:gap-[22px]">
        <Side label="Before" trip={row.before} changed={changed} lines={goods.left} units={units} old empty="Not on the plan before" />
        <span aria-hidden="true" className="hidden pt-1 text-[26px] leading-8 font-semibold lg:block">→</span>
        <Side label="Now" trip={row.after} changed={changed} lines={goods.joined} units={units} empty="Taken off this plan" />
      </div>
    </Card>
  );
}

// One side of a change: the vehicle, when it leaves, the driver, and the stops or the goods when those changed, with
// the order lines that left or joined the trip at their counts. The old side strikes what changed; the new side writes
// it in full.
function Side({ label, trip, changed, lines, units, old = false, empty }: {
  label: string; trip: KeptTrip | null; changed: Set<ChangeDetail>; lines: LineAt[]; units: boolean; old?: boolean; empty: string;
}) {
  const struck = (detail: ChangeDetail) => old && changed.has(detail);
  return (
    <div className="min-w-0">
      <p className="text-[11px] leading-[14px] font-semibold text-muted-foreground lg:sr-only">{label}</p>
      {trip ? (
        <>
          <p className={cn('font-mono text-[22px] leading-7 font-bold', old && 'text-muted-foreground/70', struck('vehicle') && 'line-through')}>{trip.vehicleId}{trip.tripNo > 1 ? ` trip ${trip.tripNo}` : ''}</p>
          <p className={cn('mt-1 text-[13px] leading-[18px]', old ? 'text-muted-foreground' : 'font-semibold')}>
            <span className={cn(struck('leaves') && 'line-through')}>{leavesLine(trip)}</span>
            {trip.driver && <> · <span className={cn(struck('driver') && 'line-through')}>{trip.driver}</span></>}
          </p>
          {(changed.has('stops') || changed.has('goods')) && (
            <p className={cn('mt-1 text-[13px] leading-[18px]', old ? 'text-muted-foreground' : 'font-semibold')}>
              <span className={cn(struck('stops') && 'line-through')}>{stopsLine(trip)}</span>
              {' · '}
              <span className={cn(old && units && 'line-through')}>{unitsWords(trip.brand, trip.units)}</span>
            </p>
          )}
          {changed.has('goods') && lines.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] leading-[14px] font-semibold text-muted-foreground">{old ? LEFT_TRIP : JOINED_TRIP}</p>
              <ul className="mt-0.5 text-[13px] leading-[18px]">
                {lines.map((line) => <li key={line.lineId} className={old ? 'text-muted-foreground line-through' : 'font-semibold'}>{lineAtWords(line, trip.brand)}</li>)}
              </ul>
            </div>
          )}
        </>
      ) : <p className="pt-1 text-[15px] leading-5 text-muted-foreground">{empty}</p>}
    </div>
  );
}
