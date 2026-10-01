import { useState } from 'react';
import type { BoardOrder, Brand, DraftDeferral, DraftPlan, DraftTrip, PlanBoard, PlanRef } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { splitOrder, type BoardScreen, type Undo } from '../board';
import { defer, keyOf, moveStop, planOf, removeTrip, sameTrip, setLeaveAt, takeOff, tripOf } from '../draft';
import { countOf, figure, hhmm, litres, orderAmount, ordersAmount, vehicleSize } from '../words';
import { DeferForm } from './DeferForm';
import { DriverMenu } from './DriverMenu';
import { driverChange } from './drivers';
import { vehicleIcon } from './icons';
import { LeaveField } from './LeaveField';
import type { BoardIndex } from './lookup';
import { SplitForm } from './SplitForm';
import { StopRow } from './StopRow';
import { Timeline } from './Timeline';
import { fuelTone, inkButton, plainButton, toneOf } from './look';
import { Figure, Tag } from './ui';

// A split or join, which the board's queue runs once the draft is saved. It says why it was refused, or null.
type Act = (run: (date: string, ref: PlanRef) => Promise<PlanBoard>) => Promise<string | null>;

// The open trip (Edit plan): its vehicle, driver, brand, district and leaving time, the checker's figures, the
// timeline with the trip's problems and their fixes, the stops in order, "+ Add a stop" and "Mark trip done".
// The numbers are the last answer's, shown only while they are for the trip on screen.
export function TripPanel({ screen, index, trip, group, change, act, onSwap, onRemoved, onDone, onAddStop, onJoin }: {
  screen: BoardScreen;
  index: BoardIndex;
  trip: DraftTrip;
  group: { brand: Brand; district: string } | null;
  change: (next: DraftPlan, undo?: Undo) => void;
  act: Act;
  onSwap: () => void;
  onRemoved: () => void;
  onDone: () => void;
  onAddStop: () => void;
  onJoin: (order: BoardOrder) => void;
}) {
  const { board, draft } = screen;
  const key = keyOf(trip);
  const [form, setForm] = useState<{ kind: 'split' | 'defer'; order: BoardOrder } | null>(null);
  const vehicle = index.vehicle(trip.vehicleId);
  // The checker's answer belongs to this trip only while the trip on screen is the one it timed.
  const inStep = sameTrip(trip, tripOf(planOf(board), key));
  const check = inStep ? index.trip(trip.vehicleId, trip.tripNo) : null;
  const times = check?.times ?? null;
  const figures = index.figures(trip.vehicleId, trip.tripNo);
  const problems = inStep ? index.problems(trip.vehicleId, trip.tripNo) : [];
  const has = (code: string) => problems.some((problem) => problem.code === code);
  const undo = screen.undo?.tripKey === key ? screen.undo : null;
  // Each stop's shop and what is unloaded there, for its dot on the timeline (spec 022).
  const stopShops = new Map(trip.stops.flatMap((stop) => {
    const shop = index.shop(stop.outletId);
    return shop ? [[stop.outletId, { name: shop.name, goods: ordersAmount(shop.brand, stop.orderIds.flatMap((id) => index.order(id) ?? [])) }] as const] : [];
  }));

  const split = async (order: BoardOrder, keep: { productId: string; quantity: number }[]) => {
    const refused = await act((date, ref) => splitOrder(date, { ...ref, orderId: order.id, keep }));
    if (refused === null) setForm(null);
    return refused;
  };
  const doDefer = (deferrals: DraftDeferral[]) => {
    change(defer(draft, deferrals));
    setForm(null);
  };
  // One change of the draft, with Undo when the driver came from another vehicle and the two swapped (spec 022).
  const chooseDriver = (driverId: string | null) => {
    const chosen = driverChange(draft, key, trip.vehicleId, driverId);
    change(chosen.plan, chosen.undo);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2 px-3.5 pt-3.5">
        {vehicle && <img src={vehicleIcon(vehicle)} alt="" className="mt-0.5 size-8 shrink-0 object-contain" />}
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="text-base leading-5 font-bold">
            Planning · {trip.vehicleId} ·{' '}
            <DriverMenu draft={draft} vehicleId={trip.vehicleId} drivers={board.drivers} driverId={trip.driverId} onChoose={chooseDriver} />
          </h2>
          <p className="mt-1 text-xs leading-[15px] text-muted-foreground">{vehicle ? `${vehicleSize(vehicle)} · ` : ''}trip {trip.tripNo} of 2</p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-1.5">
          {group && <Tag tone={group.brand === 'Fresh' ? 'good' : 'plain'} className="h-[23px]">{group.brand}</Tag>}
          {group && <Tag className="h-[23px]">{group.district}</Tag>}
          <LeaveField set={trip.leaveAt} usual={times?.leaveAt ?? null} onSet={(minutes) => change(setLeaveAt(draft, key, minutes))} />
        </div>
      </div>

      <div className={cn('flex flex-wrap items-center gap-1.5 px-3.5 pt-3', !inStep && 'opacity-60')}>
        {figures && (
          <>
            <Figure label="time" value={`${figure(figures.timePct)}%`} tone={toneOf(figures.timePct, false, has('over_time_budget'))} />
            <Figure label="kg" value={`${figure(figures.kgPct)}%`} tone={toneOf(figures.kgPct, has('over_weight'))} />
            <Figure label="m³" value={`${figure(figures.m3Pct)}%`} tone={toneOf(figures.m3Pct, has('over_volume'))} />
          </>
        )}
        {vehicle && <Figure label="fuel left" value={litres(vehicle.litresLeft)} tone={fuelTone(vehicle.fuelLeftPct, has('fuel_over_quota'))} />}
        {times && (
          <span className="ml-2 text-xs leading-[15px] text-muted-foreground">
            back {hhmm(times.backAt)} · {countOf(trip.stops.length, 'stop')} · {figure(times.km)} km
          </span>
        )}
        <Button variant="outline" className={plainButton('ml-auto h-7 px-3 text-xs')} onClick={onSwap}>Swap truck</Button>
      </div>

      <div className="px-3.5 pt-3">
        <Timeline times={times} depot={board.depot} shops={stopShops} problems={problems} onLeaveAt={(minutes) => change(setLeaveAt(draft, key, minutes))} />
      </div>

      {undo && (
        <div role="status" className="mx-3.5 mt-3 flex items-center gap-3 rounded-[10px] bg-good-tint px-3.5 py-2.5">
          <p className="flex-1 text-xs leading-[15px] font-semibold text-good">{undo.line}</p>
          <Button variant="outline" className={plainButton('h-8 px-4 text-xs')} onClick={() => change(undo.before)}>Undo</Button>
        </div>
      )}

      <h3 className="px-3.5 pt-3 pb-2 text-xs leading-[15px] font-semibold text-muted-foreground">Stops in order</h3>
      <ol className="mx-3.5">
        {trip.stops.map((stop, i) => {
          const shop = index.shop(stop.outletId);
          if (!shop) return null;
          const orders = stop.orderIds.flatMap((id) => index.order(id) ?? []);
          const time = times?.stops[i] ?? null;
          // The planner's reason for each order it planned here, both parts of a split with their original's.
          const why = orders.flatMap((order) => {
            const choice = index.choice(order.id);
            return choice ? [{ key: order.id, about: orderAmount(shop.brand, order), reason: choice.reason }] : [];
          });
          return (
            <StopRow
              key={stop.outletId}
              seq={i + 1}
              shop={shop}
              orders={orders}
              time={time}
              why={why}
              longWait={problems.some((problem) => problem.code === 'long_wait' && problem.stopSeq === i + 1)}
              first={i === 0}
              last={i === trip.stops.length - 1}
              onMove={(by) => change(moveStop(draft, key, i, by), { before: draft, line: `Stops ${Math.min(i, i + by) + 1} and ${Math.max(i, i + by) + 1} swapped`, tripKey: key })}
              onTakeOff={(order) => change(takeOff(draft, [order.id]))}
              onSplit={(order) => setForm({ kind: 'split', order })}
              onDefer={(order) => setForm({ kind: 'defer', order })}
              onJoin={onJoin}
            >
              {form && stop.orderIds.includes(form.order.id) && (form.kind === 'split'
                ? <SplitForm order={form.order} brand={shop.brand} busy={screen.acting} onSplit={(keep) => split(form.order, keep)} onCancel={() => setForm(null)} />
                : <DeferForm orders={[form.order]} index={index} code={form.order.lastDeferral?.code} reason={form.order.lastDeferral?.reason} onDefer={doDefer} onCancel={() => setForm(null)} />)}
            </StopRow>
          );
        })}
      </ol>

      <div className="px-3.5 pt-1">
        <button type="button" onClick={onAddStop} className="flex h-9 items-center gap-2 rounded-md px-1.5 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
          <span aria-hidden="true" className="text-sm font-bold">+</span> Add a stop
        </button>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 px-3.5 pt-6 pb-3.5">
        <Button variant="outline" className={plainButton('h-9 px-4 text-[13px]')} onClick={() => { change(removeTrip(draft, key)); onRemoved(); }}>Remove trip</Button>
        <Button variant="secondary" className={inkButton('h-9 px-6 text-[13px]')} onClick={onDone}>Mark trip done</Button>
      </div>
    </div>
  );
}
